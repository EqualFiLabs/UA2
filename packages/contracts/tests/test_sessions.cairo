use core::integer::u256;
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
use starknet::SyscallResultTrait;
use ua2_contracts::ua2_account::UA2Account::{
    self,
    SessionAdded,
    SessionPolicy,
    SessionRevoked,
};
use ua2_contracts::ua2_account::UA2Account::{
    ISessionManagerDispatcher,
    ISessionManagerDispatcherTrait,
};
use core::pedersen::pedersen;

const OWNER_PUBKEY: felt252 = 0x12345;

fn deploy_account() -> (starknet::ContractAddress, ISessionManagerDispatcher) {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let (contract_address, _) = contract_class.deploy(@array![OWNER_PUBKEY]).unwrap_syscall();
    let dispatcher = ISessionManagerDispatcher { contract_address };
    (contract_address, dispatcher)
}

#[test]
fn add_get_revoke_session_works() {
    let (contract_address, dispatcher) = deploy_account();

    start_cheat_caller_address(contract_address, contract_address);

    let key: felt252 = 0xABCDEF;
    let key_hash = pedersen(key, 0);
    let policy = SessionPolicy {
        is_active: false,
        expires_at: 3_600_u64,
        max_calls: 5_u32,
        calls_used: 2_u32,
        max_value_per_call: u256 { low: 0, high: 0 },
    };

    dispatcher.add_session(key, policy);

    let stored_policy = dispatcher.get_session(key_hash);
    assert(stored_policy.is_active == true, 'session inactive');
    assert(stored_policy.expires_at == 3_600_u64, 'expiry mismatch');
    assert(stored_policy.max_calls == 5_u32, 'max calls mismatch');
    assert(stored_policy.calls_used == 0_u32, 'calls used not reset');

    dispatcher.revoke_session(key_hash);

    let after_revoke = dispatcher.get_session(key_hash);
    assert(after_revoke.is_active == false, 'session still active');

    stop_cheat_caller_address(contract_address);
}

#[test]
fn events_emitted() {
    let (contract_address, dispatcher) = deploy_account();
    let mut spy = spy_events();

    start_cheat_caller_address(contract_address, contract_address);

    let key: felt252 = 0xBEEF;
    let key_hash = pedersen(key, 0);
    let policy = SessionPolicy {
        is_active: true,
        expires_at: 7_200_u64,
        max_calls: 10_u32,
        calls_used: 0_u32,
        max_value_per_call: u256 { low: 0, high: 0 },
    };

    dispatcher.add_session(key, policy);
    dispatcher.revoke_session(key_hash);

    stop_cheat_caller_address(contract_address);

    spy.assert_emitted(@array![
        (
            contract_address,
            UA2Account::Event::SessionAdded(SessionAdded {
                key_hash,
                expires_at: 7_200_u64,
                max_calls: 10_u32,
            }),
        ),
        (
            contract_address,
            UA2Account::Event::SessionRevoked(SessionRevoked { key_hash }),
        ),
    ]);
}
