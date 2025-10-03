use core::array::{Array, ArrayTrait, SpanTrait};
use core::integer::u256;
use core::result::Result;
use core::serde::Serde;
use core::traits::{Into, TryInto};

use snforge_std::{
    declare,
    start_cheat_block_timestamp,
    stop_cheat_block_timestamp,
    start_cheat_caller_address,
    stop_cheat_caller_address,
    start_cheat_signature,
    stop_cheat_signature,
    ContractClassTrait,
    DeclareResultTrait,
};
use starknet::account::Call;
use starknet::syscalls::call_contract_syscall;
use starknet::{ContractAddress, SyscallResult, SyscallResultTrait};
use ua2_contracts::ua2_account::UA2Account::SessionPolicy;

use crate::session_test_utils::{build_session_signature, session_key};

const OWNER_PUBKEY: felt252 = 0x12345;
const TRANSFER_SELECTOR: felt252 = starknet::selector!("transfer");
const ERR_POLICY_SELECTOR_DENIED: felt252 = 'ERR_POLICY_SELECTOR_DENIED';
const ERR_POLICY_TARGET_DENIED: felt252 = 'ERR_POLICY_TARGET_DENIED';
const ERR_SESSION_EXPIRED: felt252 = 'ERR_SESSION_EXPIRED';
const ERR_POLICY_CALLCAP: felt252 = 'ERR_POLICY_CALLCAP';
const ERR_VALUE_LIMIT_EXCEEDED: felt252 = 'ERR_VALUE_LIMIT_EXCEEDED';

fn deploy_account_and_mock() -> (ContractAddress, ContractAddress) {
    let account_declare = declare("UA2Account").unwrap();
    let account_class = account_declare.contract_class();
    let (account_address, _) = account_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();

    let mock_declare = declare("MockERC20").unwrap();
    let mock_class = mock_declare.contract_class();
    let (mock_address, _) = mock_class.deploy(@array![]).unwrap_syscall();

    (account_address, mock_address)
}

fn add_session_with_lists(
    account_address: ContractAddress,
    key: felt252,
    policy: SessionPolicy,
    targets: @Array<ContractAddress>,
    selectors: @Array<felt252>,
) {
    start_cheat_caller_address(account_address, account_address);

    let mut calldata = array![];
    calldata.append(key);
    let active_flag: felt252 = if policy.is_active { 1 } else { 0 };
    calldata.append(active_flag);
    calldata.append(policy.expires_at.into());
    calldata.append(policy.max_calls.into());
    calldata.append(policy.calls_used.into());
    calldata.append(policy.max_value_per_call.low.into());
    calldata.append(policy.max_value_per_call.high.into());

    let targets_len = ArrayTrait::<ContractAddress>::len(targets);
    calldata.append(targets_len.into());
    let mut i = 0_usize;
    while i < targets_len {
        let target = *ArrayTrait::<ContractAddress>::at(targets, i);
        calldata.append(target.into());
        i += 1_usize;
    }

    let selectors_len = ArrayTrait::<felt252>::len(selectors);
    calldata.append(selectors_len.into());
    i = 0_usize;
    while i < selectors_len {
        let selector = *ArrayTrait::<felt252>::at(selectors, i);
        calldata.append(selector);
        i += 1_usize;
    }

    call_contract_syscall(
        account_address,
        starknet::selector!("add_session_with_allowlists"),
        calldata.span(),
    )
    .unwrap_syscall();

    stop_cheat_caller_address(account_address);
}

fn build_transfer_call(
    mock_address: ContractAddress,
    to: ContractAddress,
    amount: u256,
) -> Call {
    let mut calldata = array![];
    calldata.append(to.into());
    calldata.append(amount.low.into());
    calldata.append(amount.high.into());

    Call { to: mock_address, selector: TRANSFER_SELECTOR, calldata: calldata.span() }
}

fn execute_session_calls(
    account_address: ContractAddress,
    calls: @Array<Call>,
    nonce: u128,
    session_pubkey: felt252,
) -> SyscallResult<Span<felt252>> {
    let zero_contract: ContractAddress = 0.try_into().unwrap();
    start_cheat_caller_address(account_address, zero_contract);
    let signature: Array<felt252> =
        build_session_signature(account_address, session_pubkey, nonce, calls);
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
        Result::Ok(_) => {
            assert(false, 'expected revert');
        },
        Result::Err(panic_data) => {
            let panic_span = panic_data.span();
            assert(panic_span.len() > 0_usize, 'missing panic data');
            let actual = *panic_span.at(0_usize);
            assert(actual == expected, 'unexpected revert reason');
        },
    }
}

#[test]
fn denies_selector_not_allowed() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        expires_at: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
    };

    let mut targets = array![mock_address];
    let selectors = array![];

    let session_pubkey = session_key();
    add_session_with_lists(account_address, session_pubkey, policy, @targets, @selectors);

    start_cheat_block_timestamp(account_address, 5_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 1_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let result = execute_session_calls(account_address, @calls, 0_u128, session_pubkey);

    assert_reverted_with(result, ERR_POLICY_SELECTOR_DENIED);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_target_not_allowed() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        expires_at: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
    };

    let targets = array![];
    let selectors = array![TRANSFER_SELECTOR];

    let session_pubkey = session_key();
    add_session_with_lists(account_address, session_pubkey, policy, @targets, @selectors);

    start_cheat_block_timestamp(account_address, 5_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 1_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let result = execute_session_calls(account_address, @calls, 0_u128, session_pubkey);

    assert_reverted_with(result, ERR_POLICY_TARGET_DENIED);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_expired_session() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        expires_at: 6_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
    };

    let mut targets = array![mock_address];
    let mut selectors = array![TRANSFER_SELECTOR];

    let session_pubkey = session_key();
    add_session_with_lists(account_address, session_pubkey, policy, @targets, @selectors);

    start_cheat_block_timestamp(account_address, 7_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 1_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let result = execute_session_calls(account_address, @calls, 0_u128, session_pubkey);

    assert_reverted_with(result, ERR_SESSION_EXPIRED);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_over_call_cap() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        expires_at: 10_000_u64,
        max_calls: 1_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
    };

    let mut targets = array![mock_address];
    let mut selectors = array![TRANSFER_SELECTOR];

    let session_pubkey = session_key();
    add_session_with_lists(account_address, session_pubkey, policy, @targets, @selectors);

    start_cheat_block_timestamp(account_address, 5_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 1_000_u128, high: 0_u128 };
    let call_one = build_transfer_call(mock_address, to, amount);
    let call_two = build_transfer_call(mock_address, to, amount);
    let calls = array![call_one, call_two];

    let result = execute_session_calls(account_address, @calls, 0_u128, session_pubkey);

    assert_reverted_with(result, ERR_POLICY_CALLCAP);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_over_value_cap() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        expires_at: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 1_000_u128, high: 0_u128 },
    };

    let mut targets = array![mock_address];
    let mut selectors = array![TRANSFER_SELECTOR];

    let session_pubkey = session_key();
    add_session_with_lists(account_address, session_pubkey, policy, @targets, @selectors);

    start_cheat_block_timestamp(account_address, 5_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 5_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let result = execute_session_calls(account_address, @calls, 0_u128, session_pubkey);

    assert_reverted_with(result, ERR_VALUE_LIMIT_EXCEEDED);

    stop_cheat_block_timestamp(account_address);
}

