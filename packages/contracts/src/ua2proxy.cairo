%lang starknet

use starknet::contract_address::ContractAddress;
use starknet::context::Context;
use starknet::storage::storage_var;
use starknet::syscalls::{get_caller_address, delegate_call};

/* UA2Proxy: Minimal UUPS-style proxy.
   Stores the implementation and admin contract addresses.
   Forwards all external calls to the current implementation via delegate_call.
*/

#[storage]
struct Storage {
    implementation: ContractAddress,
    admin: ContractAddress,
}

#[constructor]
fn constructor{syscall_ptr: felt*, storage_ptr: Storage*, range_check_ptr}(
    initial_impl: ContractAddress,
    admin_addr: ContractAddress,
) {
    implementation::write(initial_impl);
    admin::write(admin_addr);
    return ();
}

#[external]
fn upgrade{syscall_ptr: felt*, storage_ptr: Storage*, range_check_ptr}(
    new_impl: ContractAddress
) {
    let caller = get_caller_address();
    let current_admin = admin::read();
    assert(caller == current_admin, 'UA2Proxy: caller is not admin');
    implementation::write(new_impl);
    return ();
}

#[external]
fn getImplementation{syscall_ptr: felt*, storage_ptr: Storage*, range_check_ptr}() -> (impl_addr: ContractAddress) {
    let impl_addr = implementation::read();
    return (impl_addr, );
}

#[external]
fn getAdmin{syscall_ptr: felt*, storage_ptr: Storage*, range_check_ptr}() -> (admin_addr: ContractAddress) {
    let admin_addr = admin::read();
    return (admin_addr, );
}

/* Fallback handler: forwards any call to the implementation.
   Accepts the entrypoint selector and calldata, then returns the result
   of delegate_call. */
#[external]
fn __default__{syscall_ptr: felt*, storage_ptr: Storage*, range_check_ptr}(
    selector: felt,
    calldata_size: felt,
    calldata: Array<felt>
) -> (retdata_size: felt, retdata: Array<felt>) {
    let impl_addr = implementation::read();
    let (size, data) = delegate_call(impl_addr, selector, calldata_size, calldata);
    return (size, data);
}
