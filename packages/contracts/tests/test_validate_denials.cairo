use core::array::{Array, ArrayTrait, SpanTrait};
use core::integer::u256;
use core::option::Option;
use core::result::Result;
use core::serde::Serde;
use core::traits::{Into, TryInto};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, start_cheat_signature, stop_cheat_block_timestamp,
    stop_cheat_caller_address, stop_cheat_signature,
};
use starknet::account::Call;
use starknet::syscalls::call_contract_syscall;
use starknet::{ContractAddress, SyscallResult, SyscallResultTrait};
use ua2_contracts::errors::{
    ERR_POLICY_CALLCAP, ERR_POLICY_SELECTOR_DENIED, ERR_POLICY_TARGET_DENIED, ERR_SESSION_EXPIRED,
    ERR_SESSION_NOT_READY, ERR_SESSION_SELECTORS_LEN, ERR_SESSION_TARGETS_LEN, ERR_VALUE_LIMIT_EXCEEDED,
};
use ua2_contracts::session::Session;
use ua2_contracts::ua2_account::UA2Account::SessionPolicy;
use crate::session_test_utils::{build_session_signature, session_key};

const OWNER_PUBKEY: felt252 = 0x12345;
const TRANSFER_SELECTOR: felt252 = starknet::selector!("transfer");
const TRANSFER_FROM_SELECTOR: felt252 = starknet::selector!("transferFrom");

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

    let mut owned_targets: Array<ContractAddress> = array![];
    for target_ref in targets.span() {
        owned_targets.append(*target_ref);
    }
    let mut owned_selectors: Array<felt252> = array![];
    for selector_ref in selectors.span() {
        owned_selectors.append(*selector_ref);
    }

    let targets_len_usize = ArrayTrait::<ContractAddress>::len(@owned_targets);
    let selectors_len_usize = ArrayTrait::<felt252>::len(@owned_selectors);

    let targets_len: u32 = match targets_len_usize.try_into() {
        Option::Some(value) => value,
        Option::None(_) => {
            assert(false, 'targets too long');
            0_u32
        },
    };
    let selectors_len: u32 = match selectors_len_usize.try_into() {
        Option::Some(value) => value,
        Option::None(_) => {
            assert(false, 'selectors too long');
            0_u32
        },
    };

    let session = Session {
        pubkey: key,
        valid_after: policy.valid_after,
        valid_until: policy.valid_until,
        max_calls: policy.max_calls,
        value_cap: policy.max_value_per_call,
        targets_len,
        targets: owned_targets,
        selectors_len,
        selectors: owned_selectors,
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

fn build_transfer_from_call(
    mock_address: ContractAddress,
    from: ContractAddress,
    to: ContractAddress,
    amount: u256,
) -> Call {
    let mut calldata = array![];
    calldata.append(from.into());
    calldata.append(to.into());
    calldata.append(amount.low.into());
    calldata.append(amount.high.into());

    Call { to: mock_address, selector: TRANSFER_FROM_SELECTOR, calldata: calldata.span() }
}

fn execute_session_calls(
    account_address: ContractAddress,
    calls: @Array<Call>,
    nonce: u128,
    session_pubkey: felt252,
    valid_until: u64,
) -> SyscallResult<Span<felt252>> {
    let zero_contract: ContractAddress = 0.try_into().unwrap();
    start_cheat_caller_address(account_address, zero_contract);
    let signature: Array<felt252> = build_session_signature(
        account_address, session_pubkey, nonce, valid_until, calls,
    );
    start_cheat_signature(account_address, signature.span());

    let mut execute_calldata = array![];
    Serde::<Array<Call>>::serialize(calls, ref execute_calldata);

    let result = call_contract_syscall(
        account_address, starknet::selector!("__execute__"), execute_calldata.span(),
    );

    stop_cheat_signature(account_address);
    stop_cheat_caller_address(account_address);

    result
}

fn assert_reverted_with(result: SyscallResult<Span<felt252>>, expected: felt252) {
    match result {
        Result::Ok(_) => { assert(false, 'expected revert'); },
        Result::Err(panic_data) => {
            let panic_span = panic_data.span();
            assert(panic_span.len() > 0_usize, 'missing panic data');
            let actual = *panic_span.at(0_usize);
            assert(actual == expected, 'unexpected revert reason');
        },
    }
}

#[test]
fn rejects_length_mismatch() {
    let (account_address, _) = deploy_account_and_mock();

    let session_pubkey = session_key();

    start_cheat_caller_address(account_address, account_address);

    let mut empty_targets = ArrayTrait::<ContractAddress>::new();
    let mut selectors_one = ArrayTrait::<felt252>::new();
    selectors_one.append(TRANSFER_SELECTOR);

    let session_targets_mismatch = Session {
        pubkey: session_pubkey,
        valid_after: 0_u64,
        valid_until: 10_000_u64,
        max_calls: 1_u32,
        value_cap: u256 { low: 1_000_u128, high: 0_u128 },
        targets_len: 1_u32,
        targets: empty_targets,
        selectors_len: 1_u32,
        selectors: selectors_one,
    };

    let mut calldata = array![];
    Serde::<Session>::serialize(@session_targets_mismatch, ref calldata);

    let result = call_contract_syscall(
        account_address, starknet::selector!("add_session_with_allowlists"), calldata.span(),
    );

    match result {
        Result::Ok(_) => { assert(false, 'expected targets len mismatch'); },
        Result::Err(panic_data) => {
            let data = panic_data.span();
            assert(data.len() > 0_usize, 'missing panic data');
            let reason = *data.at(0_usize);
            assert(reason == ERR_SESSION_TARGETS_LEN, 'unexpected targets len error');
        },
    }

    let mut targets_one = ArrayTrait::<ContractAddress>::new();
    targets_one.append(account_address);
    let mut selectors_mismatch = ArrayTrait::<felt252>::new();
    selectors_mismatch.append(TRANSFER_SELECTOR);

    let session_selectors_mismatch = Session {
        pubkey: session_pubkey,
        valid_after: 0_u64,
        valid_until: 10_000_u64,
        max_calls: 1_u32,
        value_cap: u256 { low: 1_000_u128, high: 0_u128 },
        targets_len: 1_u32,
        targets: targets_one,
        selectors_len: 2_u32,
        selectors: selectors_mismatch,
    };

    let mut calldata_selectors = array![];
    Serde::<Session>::serialize(@session_selectors_mismatch, ref calldata_selectors);

    let selectors_result = call_contract_syscall(
        account_address,
        starknet::selector!("add_session_with_allowlists"),
        calldata_selectors.span(),
    );

    match selectors_result {
        Result::Ok(_) => { assert(false, 'expected selectors len mismatch'); },
        Result::Err(panic_data) => {
            let data = panic_data.span();
            assert(data.len() > 0_usize, 'missing panic data');
            let reason = *data.at(0_usize);
            assert(reason == ERR_SESSION_SELECTORS_LEN, 'unexpected selectors len error');
        },
    }

    stop_cheat_caller_address(account_address);
}

#[test]
fn denies_selector_not_allowed() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        valid_after: 0_u64,
        valid_until: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
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

    let result = execute_session_calls(
        account_address, @calls, 0_u128, session_pubkey, policy.valid_until,
    );

    assert_reverted_with(result, ERR_POLICY_SELECTOR_DENIED);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_target_not_allowed() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        valid_after: 0_u64,
        valid_until: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
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

    let result = execute_session_calls(
        account_address, @calls, 0_u128, session_pubkey, policy.valid_until,
    );

    assert_reverted_with(result, ERR_POLICY_TARGET_DENIED);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn empty_allowlists_reject_calls() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        valid_after: 0_u64,
        valid_until: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
    };

    let targets = array![];
    let selectors = array![];

    let session_pubkey = session_key();
    add_session_with_lists(account_address, session_pubkey, policy, @targets, @selectors);

    start_cheat_block_timestamp(account_address, 5_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 1_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let result = execute_session_calls(
        account_address,
        @calls,
        0_u128,
        session_pubkey,
        policy.valid_until,
    );

    assert_reverted_with(result, ERR_POLICY_TARGET_DENIED);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_expired_session() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        valid_after: 0_u64,
        valid_until: 6_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
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

    let result = execute_session_calls(
        account_address, @calls, 0_u128, session_pubkey, policy.valid_until,
    );

    assert_reverted_with(result, ERR_SESSION_EXPIRED);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_session_not_ready() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        valid_after: 6_000_u64,
        valid_until: 12_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
    };

    let mut targets = array![mock_address];
    let mut selectors = array![TRANSFER_SELECTOR];

    let session_pubkey = session_key();
    add_session_with_lists(account_address, session_pubkey, policy, @targets, @selectors);

    start_cheat_block_timestamp(account_address, 5_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 1_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let result = execute_session_calls(
        account_address,
        @calls,
        0_u128,
        session_pubkey,
        policy.valid_until,
    );

    assert_reverted_with(result, ERR_SESSION_NOT_READY);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_over_call_cap() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        valid_after: 0_u64,
        valid_until: 10_000_u64,
        max_calls: 1_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
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

    let result = execute_session_calls(
        account_address, @calls, 0_u128, session_pubkey, policy.valid_until,
    );

    assert_reverted_with(result, ERR_POLICY_CALLCAP);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_over_value_cap() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        valid_after: 0_u64,
        valid_until: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 1_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
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

    let result = execute_session_calls(
        account_address, @calls, 0_u128, session_pubkey, policy.valid_until,
    );

    assert_reverted_with(result, ERR_VALUE_LIMIT_EXCEEDED);

    stop_cheat_block_timestamp(account_address);
}

#[test]
fn denies_transfer_from_over_value_cap() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let policy = SessionPolicy {
        is_active: true,
        valid_after: 0_u64,
        valid_until: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 1_000_u128, high: 0_u128 },
        owner_epoch: 0_u64,
    };

    let mut targets = array![mock_address];
    let mut selectors = array![TRANSFER_FROM_SELECTOR];

    let session_pubkey = session_key();
    add_session_with_lists(account_address, session_pubkey, policy, @targets, @selectors);

    start_cheat_block_timestamp(account_address, 5_000_u64);

    let from: ContractAddress = account_address;
    let to: ContractAddress = account_address;
    let amount = u256 { low: 5_000_u128, high: 0_u128 };
    let call = build_transfer_from_call(mock_address, from, to, amount);
    let calls = array![call];

    let result = execute_session_calls(
        account_address,
        @calls,
        0_u128,
        session_pubkey,
        policy.valid_until,
    );

    assert_reverted_with(result, ERR_VALUE_LIMIT_EXCEEDED);

    stop_cheat_block_timestamp(account_address);
}

