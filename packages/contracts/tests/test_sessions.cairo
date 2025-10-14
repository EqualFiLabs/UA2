use core::array::{Array, ArrayTrait, SpanTrait};
use core::integer::u256;
use core::option::Option;
use core::pedersen::pedersen;
use core::result::ResultTrait;
use core::serde::Serde;
use core::traits::{Into, TryInto};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_block_timestamp, start_cheat_caller_address, start_cheat_signature,
    stop_cheat_block_timestamp, stop_cheat_caller_address, stop_cheat_signature,
};
use starknet::account::Call;
use starknet::syscalls::call_contract_syscall;
use starknet::{ContractAddress, SyscallResult, SyscallResultTrait};
use ua2_contracts::errors::{
    ERR_POLICY_SELECTOR_DENIED, ERR_POLICY_TARGET_DENIED, ERR_SESSION_EXPIRED,
    ERR_VALUE_LIMIT_EXCEEDED,
};
use ua2_contracts::session::Session;
use ua2_contracts::ua2_account::UA2Account::{
    self, ISessionManagerDispatcher, ISessionManagerDispatcherTrait, SessionAdded, SessionPolicy,
    SessionRevoked,
};
use crate::session_test_utils::{build_session_signature, session_key};

const OWNER_PUBKEY: felt252 = 0x12345;
const TRANSFER_SELECTOR: felt252 = starknet::selector!("transfer");

fn deploy_account() -> (starknet::ContractAddress, ISessionManagerDispatcher) {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let (contract_address, _) = contract_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();
    let dispatcher = ISessionManagerDispatcher { contract_address };
    (contract_address, dispatcher)
}

fn deploy_account_and_mock() -> (ContractAddress, ISessionManagerDispatcher, ContractAddress) {
    let (account_address, dispatcher) = deploy_account();

    let mock_declare = declare("MockERC20").unwrap();
    let mock_class = mock_declare.contract_class();
    let (mock_address, _) = mock_class.deploy(@array![]).unwrap_syscall();

    (account_address, dispatcher, mock_address)
}

fn add_session_allowlist(
    account_address: ContractAddress,
    session_pubkey: felt252,
    policy: SessionPolicy,
    mut targets: Array<ContractAddress>,
    mut selectors: Array<felt252>,
) -> felt252 {
    start_cheat_caller_address(account_address, account_address);

    let targets_len_usize = targets.len();
    let targets_len: u32 = match targets_len_usize.try_into() {
        Option::Some(value) => value,
        Option::None(_) => {
            assert(false, 'bad targets len');
            0_u32
        },
    };

    let selectors_len_usize = selectors.len();
    let selectors_len: u32 = match selectors_len_usize.try_into() {
        Option::Some(value) => value,
        Option::None(_) => {
            assert(false, 'bad selectors len');
            0_u32
        },
    };

    let session = Session {
        pubkey: session_pubkey,
        valid_after: policy.valid_after,
        valid_until: policy.valid_until,
        max_calls: policy.max_calls,
        value_cap: policy.max_value_per_call,
        targets_len,
        targets,
        selectors_len,
        selectors,
    };

    let mut calldata = array![];
    Serde::<Session>::serialize(@session, ref calldata);

    call_contract_syscall(
        account_address,
        starknet::selector!("add_session_with_allowlists"),
        calldata.span(),
    )
        .unwrap_syscall();

    stop_cheat_caller_address(account_address);

    pedersen(session_pubkey, 0)
}

fn build_transfer_call(mock_address: ContractAddress, to: ContractAddress, amount: u256) -> Call {
    let mut calldata = array![];
    calldata.append(to.into());
    calldata.append(amount.low.into());
    calldata.append(amount.high.into());

    Call { to: mock_address, selector: TRANSFER_SELECTOR, calldata: calldata.span() }
}

fn execute_session_call(
    account_address: ContractAddress,
    calls: @Array<Call>,
    signature: @Array<felt252>,
) -> SyscallResult<Span<felt252>> {
    let zero: ContractAddress = 0.try_into().unwrap();
    start_cheat_caller_address(account_address, zero);
    start_cheat_signature(account_address, signature.span());

    let mut execute_calldata = array![];
    Serde::<Array<Call>>::serialize(calls, ref execute_calldata);

    let result = call_contract_syscall(
        account_address,
        starknet::selector!("__execute__"),
        execute_calldata.span(),
    );

    stop_cheat_signature(account_address);
    stop_cheat_caller_address(account_address);

    result
}

fn assert_reverted_with(result: SyscallResult<Span<felt252>>, expected: felt252) {
    match result {
        Result::Ok(_) => { assert(false, 'expected revert'); },
        Result::Err(panic_data) => {
            let data = panic_data.span();
            assert(data.len() > 0_usize, 'missing panic data');
            let actual = *data.at(0_usize);
            assert(actual == expected, 'unexpected revert reason');
        },
    }
}

#[test]
fn test_session_add_ok() {
    let (contract_address, dispatcher) = deploy_account();

    start_cheat_caller_address(contract_address, contract_address);

    let key: felt252 = 0xABCDEF;
    let key_hash = pedersen(key, 0);
    let policy = SessionPolicy {
        is_active: false,
        valid_after: 0_u64,
        valid_until: 3_600_u64,
        max_calls: 5_u32,
        calls_used: 2_u32,
        max_value_per_call: u256 { low: 0, high: 0 },
        owner_epoch: 0_u64,
    };

    dispatcher.add_session(key, policy);

    let stored_policy = dispatcher.get_session(key_hash);
    assert(stored_policy.is_active == true, 'session inactive');
    assert(stored_policy.valid_until == 3_600_u64, 'expiry mismatch');
    assert(stored_policy.max_calls == 5_u32, 'max calls mismatch');
    assert(stored_policy.calls_used == 0_u32, 'calls used not reset');
    assert(stored_policy.owner_epoch == 0_u64, 'unexpected session epoch');

    dispatcher.revoke_session(key_hash);

    let after_revoke = dispatcher.get_session(key_hash);
    assert(after_revoke.is_active == false, 'session still active');

    stop_cheat_caller_address(contract_address);
}

#[test]
fn events_emitted() {
    let (contract_address, dispatcher) = deploy_account();
    let mut spy = spy_events();

    start_cheat_caller_address(contract_address, contract_address);

    let key: felt252 = 0xBEEF;
    let key_hash = pedersen(key, 0);
    let policy = SessionPolicy {
        is_active: true,
        valid_after: 0_u64,
        valid_until: 7_200_u64,
        max_calls: 10_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 0, high: 0 },
        owner_epoch: 0_u64,
    };

    dispatcher.add_session(key, policy);
    dispatcher.revoke_session(key_hash);

    stop_cheat_caller_address(contract_address);

    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UA2Account::Event::SessionAdded(
                        SessionAdded {
                            key_hash, valid_after: 0_u64, valid_until: 7_200_u64, max_calls: 10_u32,
                        },
                    ),
                ),
                (contract_address, UA2Account::Event::SessionRevoked(SessionRevoked { key_hash })),
            ],
        );
}

#[test]
fn test_session_expired_rejects() {
    let (account_address, _, mock_address) = deploy_account_and_mock();

    let valid_after = 0_u64;
    let valid_until = 100_u64;
    let policy = SessionPolicy {
        is_active: true,
        valid_after,
        valid_until,
        max_calls: 3_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 1_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
    };

    let session_pubkey = session_key();
    let mut targets = array![mock_address];
    let mut selectors = array![TRANSFER_SELECTOR];
    add_session_allowlist(account_address, session_pubkey, policy, targets, selectors);

    start_cheat_block_timestamp(account_address, 1_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 100_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let signature: Array<felt252> = build_session_signature(
        account_address,
        session_pubkey,
        0_u128,
        valid_until,
        @calls,
    );

    let result = execute_session_call(account_address, @calls, @signature);

    stop_cheat_block_timestamp(account_address);

    assert_reverted_with(result, ERR_SESSION_EXPIRED);
}

#[test]
fn test_session_selector_denied() {
    let (account_address, _, mock_address) = deploy_account_and_mock();

    let valid_after = 0_u64;
    let valid_until = 5_000_u64;
    let policy = SessionPolicy {
        is_active: true,
        valid_after,
        valid_until,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
    };

    let session_pubkey = session_key();
    let mut targets = array![mock_address];
    let mut selectors = array![TRANSFER_SELECTOR];
    add_session_allowlist(account_address, session_pubkey, policy, targets, selectors);

    start_cheat_block_timestamp(account_address, 1_000_u64);

    let mut calldata = array![];
    let selector = starknet::selector!("get_last");
    let call = Call { to: mock_address, selector, calldata: calldata.span() };
    let calls = array![call];

    let signature: Array<felt252> = build_session_signature(
        account_address,
        session_pubkey,
        0_u128,
        valid_until,
        @calls,
    );

    let result = execute_session_call(account_address, @calls, @signature);

    stop_cheat_block_timestamp(account_address);

    assert_reverted_with(result, ERR_POLICY_SELECTOR_DENIED);
}

#[test]
fn test_session_target_denied() {
    let (account_address, _, mock_address) = deploy_account_and_mock();

    let valid_after = 0_u64;
    let valid_until = 5_000_u64;
    let policy = SessionPolicy {
        is_active: true,
        valid_after,
        valid_until,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
    };

    let session_pubkey = session_key();
    let mut targets = array![mock_address];
    let mut selectors = array![TRANSFER_SELECTOR];
    add_session_allowlist(account_address, session_pubkey, policy, targets, selectors);

    start_cheat_block_timestamp(account_address, 1_000_u64);

    let mut calldata = array![];
    let call = Call {
        to: account_address,
        selector: starknet::selector!("get_owner"),
        calldata: calldata.span(),
    };
    let calls = array![call];

    let signature: Array<felt252> = build_session_signature(
        account_address,
        session_pubkey,
        0_u128,
        valid_until,
        @calls,
    );

    let result = execute_session_call(account_address, @calls, @signature);

    stop_cheat_block_timestamp(account_address);

    assert_reverted_with(result, ERR_POLICY_TARGET_DENIED);
}

#[test]
fn test_session_value_cap() {
    let (account_address, _, mock_address) = deploy_account_and_mock();

    let valid_after = 0_u64;
    let valid_until = 5_000_u64;
    let policy = SessionPolicy {
        is_active: true,
        valid_after,
        valid_until,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 1_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
    };

    let session_pubkey = session_key();
    let mut targets = array![mock_address];
    let mut selectors = array![TRANSFER_SELECTOR];
    add_session_allowlist(account_address, session_pubkey, policy, targets, selectors);

    start_cheat_block_timestamp(account_address, 1_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 5_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let signature: Array<felt252> = build_session_signature(
        account_address,
        session_pubkey,
        0_u128,
        valid_until,
        @calls,
    );

    let result = execute_session_call(account_address, @calls, @signature);

    stop_cheat_block_timestamp(account_address);

    assert_reverted_with(result, ERR_VALUE_LIMIT_EXCEEDED);
}
