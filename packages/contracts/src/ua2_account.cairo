use openzeppelin::account::AccountComponent;
use openzeppelin::introspection::src5::SRC5Component;

#[starknet::contract(account)]
#[feature("deprecated_legacy_map")]
pub mod UA2Account {
    use super::{AccountComponent, SRC5Component};
    use core::array::{Array, ArrayTrait, SpanTrait};
    use core::option::Option;
    use core::traits::{Into, TryInto};
    use core::integer::u256;
    use openzeppelin::account::interface;
    use starknet::account::Call;
    use starknet::storage::Map;
    use starknet::syscalls::call_contract_syscall;
    use starknet::{
        ContractAddress,
        SyscallResultTrait,
        get_block_timestamp,
        get_caller_address,
        get_contract_address,
    };

    component!(path: AccountComponent, storage: account, event: AccountEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    const ERR_SESSION_EXPIRED: felt252 = 'ERR_SESSION_EXPIRED';
    const ERR_SESSION_INACTIVE: felt252 = 'ERR_SESSION_INACTIVE';
    const ERR_POLICY_CALLCAP: felt252 = 'ERR_POLICY_CALLCAP';
    const ERR_POLICY_SELECTOR_DENIED: felt252 = 'ERR_POLICY_SELECTOR_DENIED';
    const ERR_POLICY_TARGET_DENIED: felt252 = 'ERR_POLICY_TARGET_DENIED';
    const ERR_VALUE_LIMIT_EXCEEDED: felt252 = 'ERR_VALUE_LIMIT_EXCEEDED';
    const ERR_POLICY_CALLCOUNT_MISMATCH: felt252 = 'ERR_POLICY_CALLCOUNT_MISMATCH';
    const ERC20_TRANSFER_SEL: felt252 = 0x483afd3f4caec50eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d118;
    const APPLY_SESSION_USAGE_SELECTOR: felt252 = starknet::selector!("apply_session_usage");

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        account: AccountComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        owner_pubkey: felt252,
        session: Map<felt252, SessionPolicy>,
        session_nonce: Map<felt252, u128>,
        session_target_allow: LegacyMap<(felt252, ContractAddress), bool>,
        session_selector_allow: LegacyMap<(felt252, felt252), bool>,
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

    #[derive(Drop, starknet::Event)]
    pub struct SessionUsed {
        pub key_hash: felt252,
        pub used: u32,
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
        SessionUsed: SessionUsed,
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

    fn require(condition: bool, error: felt252) {
        assert(condition, error);
    }

    fn u256_le(lhs: u256, rhs: u256) -> bool {
        if lhs.high < rhs.high {
            true
        } else if lhs.high > rhs.high {
            false
        } else {
            lhs.low <= rhs.low
        }
    }

    #[external(v0)]
    fn add_session_with_allowlists(
        ref self: ContractState,
        key: felt252,
        mut policy: SessionPolicy,
        targets: Array<ContractAddress>,
        selectors: Array<felt252>,
    ) {
        assert_owner();
        self.add_session(key, policy);

        let key_hash = key;

        let mut i = 0_usize;
        let targets_len = ArrayTrait::<ContractAddress>::len(@targets);
        while i < targets_len {
            let target = *ArrayTrait::<ContractAddress>::at(@targets, i);
            self.session_target_allow.write((key_hash, target), true);
            i += 1_usize;
        }

        i = 0_usize;
        let selectors_len = ArrayTrait::<felt252>::len(@selectors);
        while i < selectors_len {
            let selector = *ArrayTrait::<felt252>::at(@selectors, i);
            self.session_selector_allow.write((key_hash, selector), true);
            i += 1_usize;
        }
    }

    #[external(v0)]
    fn apply_session_usage(
        ref self: ContractState,
        key_hash: felt252,
        prior_calls_used: u32,
        tx_call_count: u32,
    ) {
        let mut policy = self.session.read(key_hash);

        require(policy.is_active, ERR_SESSION_INACTIVE);

        let now = get_block_timestamp();
        require(now <= policy.expires_at, ERR_SESSION_EXPIRED);

        require(policy.calls_used == prior_calls_used, ERR_POLICY_CALLCOUNT_MISMATCH);

        let updated_calls_used = checked_add_u32(policy.calls_used, tx_call_count);
        require(updated_calls_used <= policy.max_calls, ERR_POLICY_CALLCAP);

        policy.calls_used = updated_calls_used;
        self.session.write(key_hash, policy);

        self.emit(Event::SessionUsed(SessionUsed { key_hash, used: tx_call_count }));
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

    #[derive(Copy, Drop)]
    struct SessionValidation {
        key_hash: felt252,
        policy: SessionPolicy,
        tx_call_count: u32,
    }

    fn checked_add_u32(lhs: u32, rhs: u32) -> u32 {
        let sum = lhs + rhs;
        assert(sum >= lhs, ERR_POLICY_CALLCAP);
        sum
    }

    fn validate_session_policy(
        self: @ContractState,
        signature: Span<felt252>,
        calls: @Array<Call>,
    ) -> SessionValidation {
        let key_hash = *signature.at(0_usize);
        let policy = self.session.read(key_hash);

        require(policy.is_active, ERR_SESSION_INACTIVE);

        let now = get_block_timestamp();
        require(now <= policy.expires_at, ERR_SESSION_EXPIRED);

        let calls_len = ArrayTrait::<Call>::len(calls);
        let tx_call_count: u32 = match calls_len.try_into() {
            Option::Some(value) => value,
            Option::None(_) => {
                assert(false, ERR_POLICY_CALLCAP);
                0_u32
            },
        };

        let _new_calls_used = checked_add_u32(policy.calls_used, tx_call_count);
        require(_new_calls_used <= policy.max_calls, ERR_POLICY_CALLCAP);

        for call_ref in calls.span() {
            let Call { to, selector, calldata } = *call_ref;

            let target_allowed = self.session_target_allow.read((key_hash, to));
            assert(target_allowed == true, ERR_POLICY_TARGET_DENIED);

            let selector_allowed = self.session_selector_allow.read((key_hash, selector));
            assert(selector_allowed == true, ERR_POLICY_SELECTOR_DENIED);

            if selector == ERC20_TRANSFER_SEL {
                let calldata_len = calldata.len();
                require(calldata_len >= 3_usize, ERR_VALUE_LIMIT_EXCEEDED);

                let amount_low_felt = *calldata.at(1_usize);
                let amount_high_felt = *calldata.at(2_usize);

                let amount_low: u128 = match amount_low_felt.try_into() {
                    Option::Some(value) => value,
                    Option::None(_) => {
                        assert(false, ERR_VALUE_LIMIT_EXCEEDED);
                        0_u128
                    },
                };

                let amount_high: u128 = match amount_high_felt.try_into() {
                    Option::Some(value) => value,
                    Option::None(_) => {
                        assert(false, ERR_VALUE_LIMIT_EXCEEDED);
                        0_u128
                    },
                };

                let amount = u256 { low: amount_low, high: amount_high };

                require(u256_le(amount, policy.max_value_per_call), ERR_VALUE_LIMIT_EXCEEDED);
            }
        }

        SessionValidation { key_hash, policy, tx_call_count }
    }

    #[abi(embed_v0)]
    impl AccountMixinImpl of interface::AccountABI<ContractState> {
        fn __execute__(self: @ContractState, calls: Array<Call>) {
            let tx_info = starknet::get_tx_info().unbox();
            let tx_hash = tx_info.transaction_hash;
            let signature = tx_info.signature;

            let owner_valid = AccountComponent::InternalImpl::<ContractState>::_is_valid_signature(
                self.account, tx_hash, signature
            );

            if owner_valid {
                AccountComponent::AccountMixinImpl::<ContractState>::__execute__(self, calls);
                return;
            }

            let validation = validate_session_policy(self, signature, @calls);

            AccountComponent::AccountMixinImpl::<ContractState>::__execute__(self, calls);

            let mut accounting_calldata = ArrayTrait::<felt252>::new();
            accounting_calldata.append(validation.key_hash);
            accounting_calldata.append(validation.policy.calls_used.into());
            accounting_calldata.append(validation.tx_call_count.into());

            let _ = call_contract_syscall(
                get_contract_address(),
                APPLY_SESSION_USAGE_SELECTOR,
                accounting_calldata.span(),
            )
            .unwrap_syscall();
        }

        fn __validate__(self: @ContractState, calls: Array<Call>) -> felt252 {
            let tx_info = starknet::get_tx_info().unbox();
            let tx_hash = tx_info.transaction_hash;
            let signature = tx_info.signature;

            let owner_valid = AccountComponent::InternalImpl::<ContractState>::_is_valid_signature(
                self.account, tx_hash, signature
            );

            if owner_valid {
                return AccountComponent::AccountMixinImpl::<ContractState>::__validate__(self, calls);
            }

            let _validation = validate_session_policy(self, signature, @calls);

            starknet::VALIDATED
        }

        fn is_valid_signature(
            self: @ContractState, hash: felt252, signature: Array<felt252>,
        ) -> felt252 {
            AccountComponent::AccountMixinImpl::<ContractState>::is_valid_signature(
                self, hash, signature
            )
        }

        fn supports_interface(self: @ContractState, interface_id: felt252) -> bool {
            AccountComponent::AccountMixinImpl::<ContractState>::supports_interface(
                self, interface_id
            )
        }

        fn __validate_declare__(self: @ContractState, class_hash: felt252) -> felt252 {
            AccountComponent::AccountMixinImpl::<ContractState>::__validate_declare__(
                self, class_hash
            )
        }

        fn __validate_deploy__(
            self: @ContractState,
            class_hash: felt252,
            contract_address_salt: felt252,
            public_key: felt252,
        ) -> felt252 {
            AccountComponent::AccountMixinImpl::<ContractState>::__validate_deploy__(
                self, class_hash, contract_address_salt, public_key
            )
        }

        fn get_public_key(self: @ContractState) -> felt252 {
            AccountComponent::AccountMixinImpl::<ContractState>::get_public_key(self)
        }

        fn set_public_key(
            ref self: ContractState, new_public_key: felt252, signature: Span<felt252>,
        ) {
            AccountComponent::AccountMixinImpl::<ContractState>::set_public_key(
                ref self, new_public_key, signature
            );
        }

        fn isValidSignature(
            self: @ContractState, hash: felt252, signature: Array<felt252>,
        ) -> felt252 {
            AccountComponent::AccountMixinImpl::<ContractState>::isValidSignature(
                self, hash, signature
            )
        }

        fn getPublicKey(self: @ContractState) -> felt252 {
            AccountComponent::AccountMixinImpl::<ContractState>::getPublicKey(self)
        }

        fn setPublicKey(
            ref self: ContractState, newPublicKey: felt252, signature: Span<felt252>,
        ) {
            AccountComponent::AccountMixinImpl::<ContractState>::setPublicKey(
                ref self, newPublicKey, signature
            );
        }
    }
    impl AccountInternalImpl = AccountComponent::InternalImpl<ContractState>;
}
