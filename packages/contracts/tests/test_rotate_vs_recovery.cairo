use core::array::{ArrayTrait, SpanTrait};
use core::result::ResultTrait;
use core::traits::{Into, TryInto};
use snforge_std::{
    declare,
    start_cheat_caller_address,
    stop_cheat_caller_address,
    ContractClassTrait,
    DeclareResultTrait,
};
use starknet::{ContractAddress, SyscallResult, SyscallResultTrait};
use starknet::syscalls::call_contract_syscall;
use ua2_contracts::errors::ERR_RECOVERY_IN_PROGRESS;

const OWNER_PUBKEY: felt252 = 0x111;
const NEW_RECOVERY_OWNER: felt252 = 0xDEAD;
const ROTATED_OWNER: felt252 = 0xBEEF;

fn deploy_account() -> ContractAddress {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let (contract_address, _) = contract_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();
    contract_address
}

fn call_with_address(
    contract_address: ContractAddress,
    selector: felt252,
    addr: ContractAddress,
) -> SyscallResult<Span<felt252>> {
    let mut calldata = array![];
    calldata.append(addr.into());
    call_contract_syscall(contract_address, selector, calldata.span())
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

fn call_without_args(
    contract_address: ContractAddress,
    selector: felt252,
) -> SyscallResult<Span<felt252>> {
    let empty = array![];
    call_contract_syscall(contract_address, selector, empty.span())
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
fn rotate_requires_no_active_recovery() {
    let contract_address = deploy_account();

    let g1: ContractAddress = 0x1001.try_into().unwrap();
    let g2: ContractAddress = 0x1002.try_into().unwrap();

    start_cheat_caller_address(contract_address, contract_address);
    call_with_address(
        contract_address,
        starknet::selector!("add_guardian"),
        g1,
    )
    .unwrap_syscall();
    call_with_address(
        contract_address,
        starknet::selector!("add_guardian"),
        g2,
    )
    .unwrap_syscall();
    call_with_felt(
        contract_address,
        starknet::selector!("set_guardian_threshold"),
        1_u8.into(),
    )
    .unwrap_syscall();
    call_with_felt(
        contract_address,
        starknet::selector!("set_recovery_delay"),
        0_u64.into(),
    )
    .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g1);
    call_with_felt(
        contract_address,
        starknet::selector!("propose_recovery"),
        NEW_RECOVERY_OWNER,
    )
    .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, contract_address);
    let rotate_during_recovery = call_with_felt(
        contract_address,
        starknet::selector!("rotate_owner"),
        ROTATED_OWNER,
    );
    assert_reverted_with(rotate_during_recovery, ERR_RECOVERY_IN_PROGRESS);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, contract_address);
    call_without_args(
        contract_address,
        starknet::selector!("cancel_recovery"),
    )
    .unwrap_syscall();
    call_with_felt(
        contract_address,
        starknet::selector!("rotate_owner"),
        ROTATED_OWNER,
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
    assert(owner == ROTATED_OWNER, 'rotation failed post cancel');
}
