use core::array::ArrayTrait;
use core::result::ResultTrait;
use openzeppelin::upgrades::UpgradeableComponent;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::syscalls::call_contract_syscall;
use starknet::{ClassHash, ContractAddress, SyscallResult, SyscallResultTrait};
use ua2_contracts::ua2_account::UA2Account::Event;

const OWNER_PUBKEY: felt252 = 0x777;

fn deploy_account() -> (ContractAddress, ClassHash) {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let class_hash = *contract_class.class_hash;
    let (contract_address, _) = contract_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();
    (contract_address, class_hash)
}

#[test]
#[should_panic(expected: 'Account: unauthorized')]
fn upgrade_rejects_external_call() {
    let (contract_address, class_hash) = deploy_account();
    upgrade_via_call(contract_address, class_hash).unwrap_syscall();
}

#[test]
fn upgrade_emits_event_when_called_by_self() {
    let (contract_address, class_hash) = deploy_account();
    let mut spy = spy_events();

    start_cheat_caller_address(contract_address, contract_address);
    upgrade_via_call(contract_address, class_hash).unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    Event::UpgradeableEvent(
                        UpgradeableComponent::Event::Upgraded(
                            UpgradeableComponent::Upgraded { class_hash },
                        ),
                    ),
                ),
            ],
        );
}

fn upgrade_via_call(
    contract_address: ContractAddress, class_hash: ClassHash,
) -> SyscallResult<Span<felt252>> {
    let mut calldata = array![];
    let hash_felt: felt252 = class_hash.into();
    calldata.append(hash_felt);
    call_contract_syscall(contract_address, starknet::selector!("upgrade"), calldata.span())
}
