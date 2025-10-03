use core::array::{ArrayTrait, SpanTrait};
use core::result::ResultTrait;
use core::traits::{Into, TryInto};
use snforge_std::{
    declare,
    start_cheat_block_timestamp,
    stop_cheat_block_timestamp,
    start_cheat_caller_address,
    stop_cheat_caller_address,
    ContractClassTrait,
    DeclareResultTrait,
};
use starknet::{ContractAddress, SyscallResult, SyscallResultTrait};
use starknet::syscalls::call_contract_syscall;

const OWNER_PUBKEY: felt252 = 0x12345;
const RECOVERY_OWNER_A: felt252 = 0xAAA111;
const RECOVERY_OWNER_B: felt252 = 0xBBB222;
const ERR_NOT_ENOUGH_CONFIRMS: felt252 = 'ERR_NOT_ENOUGH_CONFIRMS';
const ERR_RECOVERY_IN_PROGRESS: felt252 = 'ERR_RECOVERY_IN_PROGRESS';
const ERR_RECOVERY_MISMATCH: felt252 = 'ERR_RECOVERY_MISMATCH';
const ERR_ALREADY_CONFIRMED: felt252 = 'ERR_ALREADY_CONFIRMED';
const ERR_BEFORE_ETA: felt252 = 'ERR_BEFORE_ETA';
const ERR_NO_RECOVERY: felt252 = 'ERR_NO_RECOVERY';

fn deploy_account() -> ContractAddress {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let (contract_address, _) = contract_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();
    contract_address
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
fn recovery_edge_cases() {
    let contract_address = deploy_account();
    let g1: ContractAddress = 0x111.try_into().unwrap();
    let g2: ContractAddress = 0x222.try_into().unwrap();
    let g3: ContractAddress = 0x333.try_into().unwrap();

    start_cheat_caller_address(contract_address, contract_address);
    let mut add_calldata = array![];
    add_calldata.append(g1.into());
    call_contract_syscall(
        contract_address,
        starknet::selector!("add_guardian"),
        add_calldata.span(),
    )
    .unwrap_syscall();

    let mut add_calldata = array![];
    add_calldata.append(g2.into());
    call_contract_syscall(
        contract_address,
        starknet::selector!("add_guardian"),
        add_calldata.span(),
    )
    .unwrap_syscall();

    let mut add_calldata = array![];
    add_calldata.append(g3.into());
    call_contract_syscall(
        contract_address,
        starknet::selector!("add_guardian"),
        add_calldata.span(),
    )
    .unwrap_syscall();

    let mut threshold_calldata = array![];
    threshold_calldata.append(2.into());
    call_contract_syscall(
        contract_address,
        starknet::selector!("set_guardian_threshold"),
        threshold_calldata.span(),
    )
    .unwrap_syscall();

    let mut delay_calldata = array![];
    delay_calldata.append(1_u64.into());
    call_contract_syscall(
        contract_address,
        starknet::selector!("set_recovery_delay"),
        delay_calldata.span(),
    )
    .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_block_timestamp(contract_address, 1_000_u64);

    start_cheat_caller_address(contract_address, g1);
    let mut propose_calldata = array![];
    propose_calldata.append(RECOVERY_OWNER_A);
    call_contract_syscall(
        contract_address,
        starknet::selector!("propose_recovery"),
        propose_calldata.span(),
    )
    .unwrap_syscall();

    let mut execute_calldata = array![];
    let execute_before_quorum = call_contract_syscall(
        contract_address,
        starknet::selector!("execute_recovery"),
        execute_calldata.span(),
    );
    assert_reverted_with(execute_before_quorum, ERR_NOT_ENOUGH_CONFIRMS);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g2);
    let mut second_propose_calldata = array![];
    second_propose_calldata.append(RECOVERY_OWNER_B);
    let second_propose = call_contract_syscall(
        contract_address,
        starknet::selector!("propose_recovery"),
        second_propose_calldata.span(),
    );
    assert_reverted_with(second_propose, ERR_RECOVERY_IN_PROGRESS);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g2);
    let mut confirm_calldata = array![];
    confirm_calldata.append(RECOVERY_OWNER_A);
    call_contract_syscall(
        contract_address,
        starknet::selector!("confirm_recovery"),
        confirm_calldata.span(),
    )
    .unwrap_syscall();
    let mut duplicate_confirm_calldata = array![];
    duplicate_confirm_calldata.append(RECOVERY_OWNER_A);
    let duplicate_confirm = call_contract_syscall(
        contract_address,
        starknet::selector!("confirm_recovery"),
        duplicate_confirm_calldata.span(),
    );
    assert_reverted_with(duplicate_confirm, ERR_ALREADY_CONFIRMED);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g3);
    let mut mismatch_calldata = array![];
    mismatch_calldata.append(RECOVERY_OWNER_B);
    let mismatch_confirm = call_contract_syscall(
        contract_address,
        starknet::selector!("confirm_recovery"),
        mismatch_calldata.span(),
    );
    assert_reverted_with(mismatch_confirm, ERR_RECOVERY_MISMATCH);

    let mut confirm_calldata = array![];
    confirm_calldata.append(RECOVERY_OWNER_A);
    call_contract_syscall(
        contract_address,
        starknet::selector!("confirm_recovery"),
        confirm_calldata.span(),
    )
    .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g1);
    let mut execute_eta = array![];
    let before_eta = call_contract_syscall(
        contract_address,
        starknet::selector!("execute_recovery"),
        execute_eta.span(),
    );
    assert_reverted_with(before_eta, ERR_BEFORE_ETA);
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, contract_address);
    let empty_cancel = array![];
    call_contract_syscall(
        contract_address,
        starknet::selector!("cancel_recovery"),
        empty_cancel.span(),
    )
    .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g1);
    let mut execute_after_cancel = array![];
    let after_cancel = call_contract_syscall(
        contract_address,
        starknet::selector!("execute_recovery"),
        execute_after_cancel.span(),
    );
    assert_reverted_with(after_cancel, ERR_NO_RECOVERY);
    stop_cheat_caller_address(contract_address);

    stop_cheat_block_timestamp(contract_address);
    start_cheat_block_timestamp(contract_address, 2_000_u64);

    start_cheat_caller_address(contract_address, g1);
    let mut propose_second = array![];
    propose_second.append(RECOVERY_OWNER_B);
    call_contract_syscall(
        contract_address,
        starknet::selector!("propose_recovery"),
        propose_second.span(),
    )
    .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g2);
    let mut confirm_second = array![];
    confirm_second.append(RECOVERY_OWNER_B);
    call_contract_syscall(
        contract_address,
        starknet::selector!("confirm_recovery"),
        confirm_second.span(),
    )
    .unwrap_syscall();
    stop_cheat_caller_address(contract_address);

    start_cheat_caller_address(contract_address, g3);
    let mut mismatch_second = array![];
    mismatch_second.append(RECOVERY_OWNER_A);
    let mismatch_again = call_contract_syscall(
        contract_address,
        starknet::selector!("confirm_recovery"),
        mismatch_second.span(),
    );
    assert_reverted_with(mismatch_again, ERR_RECOVERY_MISMATCH);
    stop_cheat_caller_address(contract_address);

    stop_cheat_block_timestamp(contract_address);
}
