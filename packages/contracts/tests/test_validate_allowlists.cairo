use core::array::{Array, ArrayTrait, SpanTrait};
use core::integer::u256;
use core::option::Option;
use core::serde::Serde;
use core::traits::{Into, TryInto};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_block_timestamp, start_cheat_caller_address, start_cheat_signature,
    stop_cheat_block_timestamp, stop_cheat_caller_address, stop_cheat_signature,
};
use starknet::account::Call;
use starknet::syscalls::call_contract_syscall;
use starknet::{ContractAddress, SyscallResultTrait};
use ua2_contracts::session::Session;
use ua2_contracts::ua2_account::UA2Account::{
    Event, ISessionManagerDispatcher, ISessionManagerDispatcherTrait, SessionNonceAdvanced,
    SessionPolicy, SessionUsed,
};
use crate::session_test_utils::{build_session_signature, session_key, session_key_hash};

const OWNER_PUBKEY: felt252 = 0x12345;
const TRANSFER_SELECTOR: felt252 = starknet::selector!("transfer");

#[test]
fn session_allows_whitelisted_calls() {
    let account_declare = declare("UA2Account").unwrap();
    let account_class = account_declare.contract_class();
    let (account_address, _) = account_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();
    let mut spy = spy_events();

    let mock_declare = declare("MockERC20").unwrap();
    let mock_class = mock_declare.contract_class();
    let (mock_address, _) = mock_class.deploy(@array![]).unwrap_syscall();

    let valid_after = 0_u64;
    let valid_until = 10_000_u64;

    let policy = SessionPolicy {
        is_active: true,
        valid_after,
        valid_until,
        max_calls: 1_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 1_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
    };

    start_cheat_block_timestamp(account_address, 5_000_u64);

    start_cheat_caller_address(account_address, account_address);
    let session_pubkey = session_key();
    let key_hash = session_key_hash();
    let mut targets: Array<ContractAddress> = array![];
    targets.append(mock_address);
    let mut selectors: Array<felt252> = array![];
    selectors.append(TRANSFER_SELECTOR);

    let session = Session {
        pubkey: session_pubkey,
        valid_after,
        valid_until,
        max_calls: policy.max_calls,
        value_cap: policy.max_value_per_call,
        targets_len: 1_u32,
        targets,
        selectors_len: 1_u32,
        selectors,
    };

    let mut allowlist_calldata = array![];
    Serde::<Session>::serialize(@session, ref allowlist_calldata);

    call_contract_syscall(
        account_address,
        starknet::selector!("add_session_with_allowlists"),
        allowlist_calldata.span(),
    )
        .unwrap_syscall();
    stop_cheat_caller_address(account_address);

    let session_dispatcher = ISessionManagerDispatcher { contract_address: account_address };
    let stored_policy = session_dispatcher.get_session(key_hash);
    assert(stored_policy.is_active == true, 'session inactive');
    assert(stored_policy.owner_epoch == 0_u64, 'unexpected session epoch');

    let amount = u256 { low: 500_u128, high: 0_u128 };
    let to: ContractAddress = account_address;

    let mut calldata = array![];
    calldata.append(to.into());
    calldata.append(amount.low.into());
    calldata.append(amount.high.into());

    let call = Call { to: mock_address, selector: TRANSFER_SELECTOR, calldata: calldata.span() };
    let mut calls = array![call];

    let zero_contract: ContractAddress = 0.try_into().unwrap();
    start_cheat_caller_address(account_address, zero_contract);
    let signature: Array<felt252> = build_session_signature(
        account_address, session_pubkey, 0_u128, policy.valid_until, @calls,
    );
    start_cheat_signature(account_address, signature.span());
    let mut execute_calldata = array![];
    Serde::<Array<Call>>::serialize(@calls, ref execute_calldata);
    call_contract_syscall(
        account_address, starknet::selector!("__execute__"), execute_calldata.span(),
    )
        .unwrap_syscall();

    stop_cheat_signature(account_address);
    stop_cheat_caller_address(account_address);
    stop_cheat_block_timestamp(account_address);

    spy
        .assert_emitted(
            @array![
                (account_address, Event::SessionUsed(SessionUsed { key_hash, used: 1_u32 })),
                (
                    account_address,
                    Event::SessionNonceAdvanced(
                        SessionNonceAdvanced { key_hash, new_nonce: 1_u128 },
                    ),
                ),
            ],
        );

    let get_last_result = call_contract_syscall(
        mock_address, starknet::selector!("get_last"), array![].span(),
    )
        .unwrap_syscall();

    let recorded_to_felt = *get_last_result.at(0);
    let recorded_low_felt = *get_last_result.at(1);
    let recorded_high_felt = *get_last_result.at(2);

    let recorded_to: ContractAddress = match recorded_to_felt.try_into() {
        Option::Some(addr) => addr,
        Option::None(_) => {
            assert(false, 'invalid recorded address');
            0.try_into().unwrap()
        },
    };

    let recorded_amount = u256 {
        low: match recorded_low_felt.try_into() {
            Option::Some(value) => value,
            Option::None(_) => {
                assert(false, 'invalid amount low');
                0.try_into().unwrap()
            },
        },
        high: match recorded_high_felt.try_into() {
            Option::Some(value) => value,
            Option::None(_) => {
                assert(false, 'invalid amount high');
                0.try_into().unwrap()
            },
        },
    };

    assert(recorded_to == to, 'incorrect transfer recipient');
    assert(recorded_amount == amount, 'incorrect transfer amount');
}
