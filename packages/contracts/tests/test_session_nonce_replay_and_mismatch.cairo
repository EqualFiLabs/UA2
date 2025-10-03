use core::array::{Array, ArrayTrait};
use core::integer::u256;
use core::serde::Serde;
use core::traits::{Into, TryInto};
use core::result::Result;

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
const ERR_BAD_SESSION_NONCE: felt252 = 'ERR_BAD_SESSION_NONCE';
const ERR_SESSION_SIG_INVALID: felt252 = 'ERR_SESSION_SIG_INVALID';

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

    let mut calldata = array![];
    calldata.append(session_pubkey);
    let active_flag: felt252 = if policy.is_active { 1 } else { 0 };
    calldata.append(active_flag);
    calldata.append(policy.expires_at.into());
    calldata.append(policy.max_calls.into());
    calldata.append(policy.calls_used.into());
    calldata.append(policy.max_value_per_call.low.into());
    calldata.append(policy.max_value_per_call.high.into());

    calldata.append(1.into());
    calldata.append(mock_address.into());
    calldata.append(1.into());
    calldata.append(TRANSFER_SELECTOR);

    call_contract_syscall(
        account_address,
        starknet::selector!("add_session_with_allowlists"),
        calldata.span(),
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
    account_address: ContractAddress,
    calls: @Array<Call>,
    signature: @Array<felt252>,
) -> SyscallResult<Span<felt252>> {
    let zero_contract: ContractAddress = 0.try_into().unwrap();
    start_cheat_caller_address(account_address, zero_contract);
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
fn test_session_nonce_replay_and_mismatch() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let session_pubkey = session_key();
    let policy = SessionPolicy {
        is_active: true,
        expires_at: 10_000_u64,
        max_calls: 5_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 10_000_u128, high: 0_u128 },
    };

    add_session(account_address, session_pubkey, mock_address, policy);

    start_cheat_block_timestamp(account_address, 5_000_u64);

    let to: ContractAddress = account_address;
    let amount = u256 { low: 1_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let signature0: Array<felt252> =
        build_session_signature(account_address, session_pubkey, 0_u128, @calls);
    execute_with_signature(account_address, @calls, @signature0).unwrap_syscall();

    let replay_result = execute_with_signature(account_address, @calls, @signature0);
    assert_reverted_with(replay_result, ERR_BAD_SESSION_NONCE);

    let skip_signature: Array<felt252> =
        build_session_signature(account_address, session_pubkey, 2_u128, @calls);
    let skip_result = execute_with_signature(account_address, @calls, @skip_signature);
    assert_reverted_with(skip_result, ERR_BAD_SESSION_NONCE);

    let signature1: Array<felt252> =
        build_session_signature(account_address, session_pubkey, 1_u128, @calls);
    execute_with_signature(account_address, @calls, @signature1).unwrap_syscall();

    let signature2: Array<felt252> =
        build_session_signature(account_address, session_pubkey, 2_u128, @calls);

    let tampered_amount = u256 { low: 1_001_u128, high: 0_u128 };
    let tampered_call = build_transfer_call(mock_address, to, tampered_amount);
    let tampered_calls = array![tampered_call];

    let invalid_result = execute_with_signature(account_address, @tampered_calls, @signature2);
    assert_reverted_with(invalid_result, ERR_SESSION_SIG_INVALID);

    stop_cheat_block_timestamp(account_address);
}
