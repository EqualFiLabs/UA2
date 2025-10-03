use core::integer::u256;
use starknet::ContractAddress;

#[starknet::contract]
pub mod MockERC20 {
    use super::{ContractAddress, u256};

    #[storage]
    pub struct Storage {
        last_to: ContractAddress,
        last_amount: u256,
    }

    #[external(v0)]
    fn transfer(ref self: ContractState, to: ContractAddress, amount: u256) -> bool {
        self.last_to.write(to);
        self.last_amount.write(amount);
        true
    }

    #[external(v0)]
    fn get_last(self: @ContractState) -> (ContractAddress, u256) {
        (self.last_to.read(), self.last_amount.read())
    }
}
