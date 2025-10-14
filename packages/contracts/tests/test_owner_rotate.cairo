use core::array::{ArrayTrait, SpanTrait};
use core::result::ResultTrait;
use snforge_std::{
    declare,
    spy_events,
    start_cheat_caller_address,
    stop_cheat_caller_address,
    ContractClassTrait,
    DeclareResultTrait,
    EventSpyAssertionsTrait,
};
use starknet::{ContractAddress, SyscallResult, SyscallResultTrait};
use starknet::syscalls::call_contract_syscall;
use ua2_contracts::ua2_account::UA2Account::{Event, OwnerRotated};
use ua2_contracts::errors::{ERR_NOT_OWNER, ERR_SAME_OWNER, ERR_ZERO_OWNER};

const OWNER_PUBKEY: felt252 = 0x111;
const NEW_OWNER: felt252 = 0x222;

fn deploy_account() -> ContractAddress {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let (contract_address, _) = contract_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();
    contract_address
}

fn call_with_felt(
    contract_address: ContractAddress,
    selector: felt252,
    value: felt252,
) -> SyscallResult<Span<felt252>> {
    let mut calldata = array![];
    calldata.append(value);
    call_contract_syscall(contract_address, selector, calldata.span())
}

fn assert_reverted_with(result: SyscallResult<Span<felt252>>, expected: felt252) {
    match result {
        Result::Ok(_) => {
            assert(false, 'expected revert');
        },
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
    call_with_felt(
        contract_address,
        starknet::selector!("rotate_owner"),
        NEW_OWNER,
    )
    .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    let empty = array![];
    let owner_result = call_contract_syscall(
        contract_address,
        starknet::selector!("get_owner"),
        empty.span(),
    )
    .unwrap_syscall();
    let owner = *owner_result.at(0_usize);
    assert(owner == NEW_OWNER, 'owner not rotated');

    spy.assert_emitted(@array![
        (
            contract_address,
            Event::OwnerRotated(OwnerRotated { new_owner: NEW_OWNER }),
        ),
    ]);
}

#[test]
fn owner_rotation_rejects_zero_and_same() {
    let contract_address = deploy_account();

    start_cheat_caller_address(contract_address, contract_address);
    let zero_owner = call_with_felt(
        contract_address,
        starknet::selector!("rotate_owner"),
        0,
    );
    assert_reverted_with(zero_owner, ERR_ZERO_OWNER);

    let same_owner = call_with_felt(
        contract_address,
        starknet::selector!("rotate_owner"),
        OWNER_PUBKEY,
    );
    assert_reverted_with(same_owner, ERR_SAME_OWNER);
    stop_cheat_caller_address(contract_address);
}

#[test]
fn non_owner_cannot_rotate() {
    let contract_address = deploy_account();

    let result = call_with_felt(
        contract_address,
        starknet::selector!("rotate_owner"),
        0xBBB,
    );
    assert_reverted_with(result, ERR_NOT_OWNER);

    let empty = array![];
    let owner_result = call_contract_syscall(
        contract_address,
        starknet::selector!("get_owner"),
        empty.span(),
    )
    .unwrap_syscall();
    let owner = *owner_result.at(0_usize);
    assert(owner == OWNER_PUBKEY, 'owner should remain original');
}
