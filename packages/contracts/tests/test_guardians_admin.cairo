use core::array::{ArrayTrait, SpanTrait};
use core::result::ResultTrait;
use core::traits::{Into, TryInto};
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
use ua2_contracts::ua2_account::UA2Account::{
    Event,
    GuardianAdded,
    GuardianRemoved,
    RecoveryDelaySet,
    ThresholdSet,
};

const OWNER_PUBKEY: felt252 = 0x12345;
const ERR_GUARDIAN_EXISTS: felt252 = 'ERR_GUARDIAN_EXISTS';
const ERR_BAD_THRESHOLD: felt252 = 'ERR_BAD_THRESHOLD';
const ERR_NOT_GUARDIAN: felt252 = 'ERR_NOT_GUARDIAN';

fn deploy_account() -> ContractAddress {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let (contract_address, _) = contract_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();
    contract_address
}

fn call_with_guardian(
    contract_address: ContractAddress,
    selector: felt252,
    guardian: ContractAddress,
) -> SyscallResult<Span<felt252>> {
    let mut calldata = array![];
    calldata.append(guardian.into());
    call_contract_syscall(contract_address, selector, calldata.span())
}

fn call_with_value(
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
fn guardians_admin_works() {
    let contract_address = deploy_account();
    let g1: ContractAddress = 0x111.try_into().unwrap();
    let g2: ContractAddress = 0x222.try_into().unwrap();
    let g3: ContractAddress = 0x333.try_into().unwrap();
    let g4: ContractAddress = 0x444.try_into().unwrap();

    let mut spy = spy_events();

    start_cheat_caller_address(contract_address, contract_address);

    call_with_guardian(contract_address, starknet::selector!("add_guardian"), g1)
        .unwrap_syscall();
    call_with_guardian(contract_address, starknet::selector!("add_guardian"), g2)
        .unwrap_syscall();
    call_with_guardian(contract_address, starknet::selector!("add_guardian"), g3)
        .unwrap_syscall();

    let duplicate = call_with_guardian(
        contract_address,
        starknet::selector!("add_guardian"),
        g1,
    );
    assert_reverted_with(duplicate, ERR_GUARDIAN_EXISTS);

    call_with_value(
        contract_address,
        starknet::selector!("set_guardian_threshold"),
        2.into(),
    )
    .unwrap_syscall();
    call_with_value(
        contract_address,
        starknet::selector!("set_recovery_delay"),
        60_u64.into(),
    )
    .unwrap_syscall();
    call_with_guardian(contract_address, starknet::selector!("remove_guardian"), g3)
        .unwrap_syscall();

    let bad_remove = call_with_guardian(
        contract_address,
        starknet::selector!("remove_guardian"),
        g4,
    );
    assert_reverted_with(bad_remove, ERR_NOT_GUARDIAN);

    let bad_threshold = call_with_value(
        contract_address,
        starknet::selector!("set_guardian_threshold"),
        3.into(),
    );
    assert_reverted_with(bad_threshold, ERR_BAD_THRESHOLD);

    stop_cheat_caller_address(contract_address);

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
            Event::RecoveryDelaySet(RecoveryDelaySet { delay: 60_u64 }),
        ),
        (
            contract_address,
            Event::GuardianRemoved(GuardianRemoved { addr: g3 }),
        ),
    ]);
}
