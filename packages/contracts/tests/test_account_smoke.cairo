use core::array::SpanTrait;
use core::result::ResultTrait;
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use starknet::SyscallResultTrait;

const OWNER_PUBKEY: felt252 = 0x12345;

#[test]
fn owner_getter_works() {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let (contract_address, _) = contract_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();

    let empty = array![];
    let result = starknet::syscalls::call_contract_syscall(
        contract_address,
        starknet::selector!("get_owner"),
        empty.span(),
    )
    .unwrap_syscall();
    let owner = *result.at(0);
    assert(owner == OWNER_PUBKEY, 'owner mismatch');
}
