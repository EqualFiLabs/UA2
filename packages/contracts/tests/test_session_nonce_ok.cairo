use core::array::{Array, ArrayTrait};
use core::integer::u256;
use core::serde::Serde;
use core::traits::Into;
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

fn deploy_account_and_mock() -> (ContractAddress, ContractAddress) {
    let account_declare = declare("UA2Account").unwrap();
    let account_class = account_declare.contract_class();
    let (account_address, _) = account_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();

    let mock_declare = declare("MockERC20").unwrap();
    let mock_class = mock_declare.contract_class();
    let (mock_address, _) = mock_class.deploy(@array![]).unwrap_syscall();

    (account_address, mock_address)
}

fn add_session(
    account_address: ContractAddress,
    session_pubkey: felt252,
    mock_address: ContractAddress,
    policy: SessionPolicy,
) {
    start_cheat_caller_address(account_address, account_address);

    let mut targets: Array<ContractAddress> = array![];
    targets.append(mock_address);

    let mut selectors: Array<felt252> = array![];
    selectors.append(TRANSFER_SELECTOR);

    let session = Session {
        pubkey: session_pubkey,
        valid_after: policy.valid_after,
        valid_until: policy.valid_until,
        max_calls: policy.max_calls,
        value_cap: policy.max_value_per_call,
        targets_len: 1_u32,
        targets,
        selectors_len: 1_u32,
        selectors,
    };

    let mut calldata = array![];
    Serde::<Session>::serialize(@session, ref calldata);

    call_contract_syscall(
        account_address, starknet::selector!("add_session_with_allowlists"), calldata.span(),
    )
        .unwrap_syscall();

    stop_cheat_caller_address(account_address);
}

fn build_transfer_call(mock_address: ContractAddress, to: ContractAddress, amount: u256) -> Call {
    let mut calldata = array![];
    calldata.append(to.into());
    calldata.append(amount.low.into());
    calldata.append(amount.high.into());

    Call { to: mock_address, selector: TRANSFER_SELECTOR, calldata: calldata.span() }
}

fn execute_with_signature(
    account_address: ContractAddress, calls: @Array<Call>, signature: @Array<felt252>,
) {
    let zero_contract: ContractAddress = 0.try_into().unwrap();
    start_cheat_caller_address(account_address, zero_contract);
    start_cheat_signature(account_address, signature.span());

    let mut execute_calldata = array![];
    Serde::<Array<Call>>::serialize(calls, ref execute_calldata);

    call_contract_syscall(
        account_address, starknet::selector!("__execute__"), execute_calldata.span(),
    )
        .unwrap_syscall();

    stop_cheat_signature(account_address);
    stop_cheat_caller_address(account_address);
}

#[test]
fn test_session_nonce_ok() {
    let (account_address, mock_address) = deploy_account_and_mock();
    let mut spy = spy_events();

    let session_pubkey = session_key();
    let key_hash = session_key_hash();
    let policy = SessionPolicy {
        is_active: true,
        valid_after: 0_u64,
        valid_until: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
    };

    add_session(account_address, session_pubkey, mock_address, policy);

    start_cheat_block_timestamp(account_address, 5_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 1_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let signature0: Array<felt252> = build_session_signature(
        account_address, session_pubkey, 0_u128, policy.valid_until, @calls,
    );
    execute_with_signature(account_address, @calls, @signature0);

    let signature1: Array<felt252> = build_session_signature(
        account_address, session_pubkey, 1_u128, policy.valid_until, @calls,
    );
    execute_with_signature(account_address, @calls, @signature1);

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
                (account_address, Event::SessionUsed(SessionUsed { key_hash, used: 1_u32 })),
                (
                    account_address,
                    Event::SessionNonceAdvanced(
                        SessionNonceAdvanced { key_hash, new_nonce: 2_u128 },
                    ),
                ),
            ],
        );

    let dispatcher = ISessionManagerDispatcher { contract_address: account_address };
    let updated_policy = dispatcher.get_session(key_hash);
    assert(updated_policy.calls_used == 2_u32, 'unexpected call count');
    assert(updated_policy.owner_epoch == 0_u64, 'unexpected session epoch');
}
