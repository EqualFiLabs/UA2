use core::array::{ArrayTrait, SpanTrait};
use core::result::ResultTrait;
use core::traits::{Into, TryInto};
use snforge_std::{
    declare,
    spy_events,
    start_cheat_block_timestamp,
    start_cheat_caller_address,
    stop_cheat_block_timestamp,
    stop_cheat_caller_address,
    ContractClassTrait,
    DeclareResultTrait,
    EventSpyAssertionsTrait,
};
use starknet::{ContractAddress, SyscallResult, SyscallResultTrait};
use starknet::syscalls::call_contract_syscall;
use ua2_contracts::ua2_account::UA2Account::{
    Event,
    GuardianAdded,
    GuardianFinalized,
    GuardianProposed,
    OwnerRotated,
    RecoveryConfirmed,
    RecoveryDelaySet,
    RecoveryExecuted,
    RecoveryProposed,
    ThresholdSet,
};
use ua2_contracts::errors::ERR_NO_RECOVERY;

const OWNER_PUBKEY: felt252 = 0x12345;
const NEW_OWNER: felt252 = 0xABCDEF0123;

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
fn recovery_happy_path() {
    let contract_address = deploy_account();
    let g1: ContractAddress = 0x111.try_into().unwrap();
    let g2: ContractAddress = 0x222.try_into().unwrap();
    let g3: ContractAddress = 0x333.try_into().unwrap();

    let mut spy = spy_events();

    start_cheat_caller_address(contract_address, contract_address);
    call_with_address(contract_address, starknet::selector!("add_guardian"), g1).unwrap_syscall();
    call_with_address(contract_address, starknet::selector!("add_guardian"), g2).unwrap_syscall();
    call_with_address(contract_address, starknet::selector!("add_guardian"), g3).unwrap_syscall();

    call_with_felt(contract_address, starknet::selector!("set_guardian_threshold"), 2.into())
        .unwrap_syscall();
    call_with_felt(contract_address, starknet::selector!("set_recovery_delay"), 0_u64.into())
        .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_block_timestamp(contract_address, 100_u64);

    start_cheat_caller_address(contract_address, g1);
    call_with_felt(contract_address, starknet::selector!("propose_recovery"), NEW_OWNER)
        .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g2);
    call_with_felt(contract_address, starknet::selector!("confirm_recovery"), NEW_OWNER)
        .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g1);
    let empty = array![];
    call_contract_syscall(contract_address, starknet::selector!("execute_recovery"), empty.span())
        .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    let empty_owner = array![];
    let owner_result = call_contract_syscall(
        contract_address,
        starknet::selector!("get_owner"),
        empty_owner.span(),
    )
    .unwrap_syscall();
    let owner = *owner_result.at(0_usize);
    assert(owner == NEW_OWNER, 'owner not rotated');

    start_cheat_caller_address(contract_address, g1);
    let empty = array![];
    let second_execute = call_contract_syscall(
        contract_address,
        starknet::selector!("execute_recovery"),
        empty.span(),
    );
    stop_cheat_caller_address(contract_address);
    assert_reverted_with(second_execute, ERR_NO_RECOVERY);

    stop_cheat_block_timestamp(contract_address);

    spy.assert_emitted(@array![
        (
            contract_address,
            Event::GuardianAdded(GuardianAdded { addr: g1 }),
        ),
        (
            contract_address,
            Event::GuardianAdded(GuardianAdded { addr: g2 }),
        ),
        (
            contract_address,
            Event::GuardianAdded(GuardianAdded { addr: g3 }),
        ),
        (
            contract_address,
            Event::ThresholdSet(ThresholdSet { threshold: 2_u8 }),
        ),
        (
            contract_address,
            Event::RecoveryDelaySet(RecoveryDelaySet { delay: 0_u64 }),
        ),
        (
            contract_address,
            Event::RecoveryConfirmed(RecoveryConfirmed {
                guardian: g1,
                new_owner: NEW_OWNER,
                count: 1_u32,
            }),
        ),
        (
            contract_address,
            Event::GuardianProposed(GuardianProposed {
                guardian: g1,
                proposal_id: 1_u64,
                new_owner: NEW_OWNER,
                eta: 100_u64,
            }),
        ),
        (
            contract_address,
            Event::RecoveryProposed(RecoveryProposed {
                new_owner: NEW_OWNER,
                eta: 100_u64,
            }),
        ),
        (
            contract_address,
            Event::RecoveryConfirmed(RecoveryConfirmed {
                guardian: g2,
                new_owner: NEW_OWNER,
                count: 2_u32,
            }),
        ),
        (
            contract_address,
            Event::OwnerRotated(OwnerRotated {
                new_owner: NEW_OWNER,
            }),
        ),
        (
            contract_address,
            Event::RecoveryExecuted(RecoveryExecuted {
                new_owner: NEW_OWNER,
            }),
        ),
        (
            contract_address,
            Event::GuardianFinalized(GuardianFinalized {
                guardian: g1,
                proposal_id: 1_u64,
                new_owner: NEW_OWNER,
            }),
        ),
    ]);
}
