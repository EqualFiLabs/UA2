use openzeppelin::account::AccountComponent;
use openzeppelin::introspection::src5::SRC5Component;

#[starknet::contract(account)]
pub mod UA2Account {
    use super::{AccountComponent, SRC5Component};
    use core::integer::u256;
    use starknet::storage::Map;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};

    component!(path: AccountComponent, storage: account, event: AccountEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        account: AccountComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        owner_pubkey: felt252,
        session: Map<felt252, SessionPolicy>,
        session_nonce: Map<felt252, u128>,
    }

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct SessionPolicy {
        pub is_active: bool,
        pub expires_at: u64,
        pub max_calls: u32,
        pub calls_used: u32,
        pub max_value_per_call: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SessionAdded {
        pub key_hash: felt252,
        pub expires_at: u64,
        pub max_calls: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SessionRevoked {
        pub key_hash: felt252,
    }

    #[starknet::interface]
    pub trait ISessionManager<TContractState> {
        fn add_session(ref self: TContractState, key: felt252, policy: SessionPolicy);
        fn get_session(self: @TContractState, key_hash: felt252) -> SessionPolicy;
        fn revoke_session(ref self: TContractState, key_hash: felt252);
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        AccountEvent: AccountComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
        SessionAdded: SessionAdded,
        SessionRevoked: SessionRevoked,
    }

    #[constructor]
    fn constructor(ref self: ContractState, public_key: felt252) {
        self.owner_pubkey.write(public_key);
        self.account.initializer(public_key);
    }

    #[external(v0)]
    fn get_owner(self: @ContractState) -> felt252 {
        self.owner_pubkey.read()
    }

    fn assert_owner() {
        let caller: ContractAddress = get_caller_address();
        let contract_address: ContractAddress = get_contract_address();
        assert(caller == contract_address, 'NOT_OWNER');
    }

    #[abi(embed_v0)]
    impl SessionManagerImpl of ISessionManager<ContractState> {
        fn add_session(ref self: ContractState, key: felt252, mut policy: SessionPolicy) {
            assert_owner();

            assert(policy.expires_at > 0_u64, 'BAD_EXPIRY');
            assert(policy.max_calls > 0_u32, 'BAD_MAX_CALLS');

            let key_hash = key;

            policy.is_active = true;
            policy.calls_used = 0_u32;

            self.session.write(key_hash, policy);
            self.session_nonce.write(key_hash, 0_u128);

            self.emit(Event::SessionAdded(SessionAdded { key_hash, expires_at: policy.expires_at, max_calls: policy.max_calls }));
        }

        fn get_session(self: @ContractState, key_hash: felt252) -> SessionPolicy {
            self.session.read(key_hash)
        }

        fn revoke_session(ref self: ContractState, key_hash: felt252) {
            assert_owner();

            let mut policy = self.session.read(key_hash);

            if policy.is_active {
                policy.is_active = false;
                self.session.write(key_hash, policy);
            }

            self.emit(Event::SessionRevoked(SessionRevoked { key_hash }));
        }
    }

    #[abi(embed_v0)]
    impl AccountMixinImpl = AccountComponent::AccountMixinImpl<ContractState>;
    impl AccountInternalImpl = AccountComponent::InternalImpl<ContractState>;
}
