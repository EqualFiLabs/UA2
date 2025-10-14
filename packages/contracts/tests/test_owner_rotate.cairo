use core::array::{Array, ArrayTrait, SpanTrait};
use core::integer::u256;
use core::result::ResultTrait;
use core::serde::Serde;
use core::traits::{Into, TryInto};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, start_cheat_signature, stop_cheat_caller_address,
    stop_cheat_signature,
};
use starknet::account::Call;
use starknet::syscalls::call_contract_syscall;
use starknet::{ContractAddress, SyscallResult, SyscallResultTrait};
use ua2_contracts::errors::{ERR_NOT_OWNER, ERR_SAME_OWNER, ERR_SESSION_STALE, ERR_ZERO_OWNER};
use ua2_contracts::session::Session;
use ua2_contracts::ua2_account::UA2Account::{Event, OwnerRotated, SessionPolicy};
use crate::session_test_utils::{build_session_signature, session_key};

const OWNER_PUBKEY: felt252 = 0x111;
const NEW_OWNER: felt252 = 0x222;
const TRANSFER_SELECTOR: felt252 = starknet::selector!("transfer");

fn deploy_account() -> ContractAddress {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let (contract_address, _) = contract_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();
    contract_address
}

fn deploy_account_and_mock() -> (ContractAddress, ContractAddress) {
    let account_address = deploy_account();

    let mock_declare = declare("MockERC20").unwrap();
    let mock_class = mock_declare.contract_class();
    let (mock_address, _) = mock_class.deploy(@array![]).unwrap_syscall();

    (account_address, mock_address)
}

fn call_with_felt(
    contract_address: ContractAddress, selector: felt252, value: felt252,
) -> SyscallResult<Span<felt252>> {
    let mut calldata = array![];
    calldata.append(value);
    call_contract_syscall(contract_address, selector, calldata.span())
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

fn execute_session_call(
    account_address: ContractAddress, calls: @Array<Call>, signature: @Array<felt252>,
) -> SyscallResult<Span<felt252>> {
    let zero_contract: ContractAddress = 0.try_into().unwrap();
    start_cheat_caller_address(account_address, zero_contract);
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
            let data = panic_data.span();
            assert(data.len() > 0_usize, 'missing panic data');
            let actual = *data.at(0_usize);
            assert(actual == expected, 'unexpected revert reason');
        },
    }
}

#[test]
fn owner_rotation_happy() {
    let contract_address = deploy_account();
    let mut spy = spy_events();

    start_cheat_caller_address(contract_address, contract_address);
    call_with_felt(contract_address, starknet::selector!("rotate_owner"), NEW_OWNER)
        .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    let empty = array![];
    let owner_result = call_contract_syscall(
        contract_address, starknet::selector!("get_owner"), empty.span(),
    )
        .unwrap_syscall();
    let owner = *owner_result.at(0_usize);
    assert(owner == NEW_OWNER, 'owner not rotated');

    spy
        .assert_emitted(
            @array![(contract_address, Event::OwnerRotated(OwnerRotated { new_owner: NEW_OWNER }))],
        );
}

#[test]
fn owner_rotation_rejects_zero_and_same() {
    let contract_address = deploy_account();

    start_cheat_caller_address(contract_address, contract_address);
    let zero_owner = call_with_felt(contract_address, starknet::selector!("rotate_owner"), 0);
    assert_reverted_with(zero_owner, ERR_ZERO_OWNER);

    let same_owner = call_with_felt(
        contract_address, starknet::selector!("rotate_owner"), OWNER_PUBKEY,
    );
    assert_reverted_with(same_owner, ERR_SAME_OWNER);
    stop_cheat_caller_address(contract_address);
}

#[test]
fn non_owner_cannot_rotate() {
    let contract_address = deploy_account();

    let result = call_with_felt(contract_address, starknet::selector!("rotate_owner"), 0xBBB);
    assert_reverted_with(result, ERR_NOT_OWNER);

    let empty = array![];
    let owner_result = call_contract_syscall(
        contract_address, starknet::selector!("get_owner"), empty.span(),
    )
        .unwrap_syscall();
    let owner = *owner_result.at(0_usize);
    assert(owner == OWNER_PUBKEY, 'owner should remain original');
}

#[test]
fn sessions_are_invalidated_on_owner_rotation() {
    let (account_address, mock_address) = deploy_account_and_mock();

    let session_pubkey = session_key();
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

    let to: ContractAddress = account_address;
    let amount = u256 { low: 1_000_u128, high: 0_u128 };
    let call = build_transfer_call(mock_address, to, amount);
    let calls = array![call];

    let first_signature: Array<felt252> = build_session_signature(
        account_address, session_pubkey, 0_u128, policy.valid_until, @calls,
    );
    execute_session_call(account_address, @calls, @first_signature).unwrap_syscall();

    start_cheat_caller_address(account_address, account_address);
    call_with_felt(account_address, starknet::selector!("rotate_owner"), NEW_OWNER)
        .unwrap_syscall();
    stop_cheat_caller_address(account_address);

    let second_signature: Array<felt252> = build_session_signature(
        account_address, session_pubkey, 1_u128, policy.valid_until, @calls,
    );
    let result = execute_session_call(account_address, @calls, @second_signature);

    assert_reverted_with(result, ERR_SESSION_STALE);
}
