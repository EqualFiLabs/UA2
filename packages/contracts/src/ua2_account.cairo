use openzeppelin::account::AccountComponent;
use openzeppelin::introspection::src5::SRC5Component;

#[starknet::contract(account)]
#[feature("deprecated_legacy_map")]
pub mod UA2Account {
    use super::{AccountComponent, SRC5Component};
    use crate::session::Session;
    use core::array::{Array, ArrayTrait, SpanTrait};
    use core::option::Option;
    use core::traits::{Into, TryInto};
    use core::integer::u256;
    use core::serde::Serde;
    use core::ecdsa::check_ecdsa_signature;
    use core::poseidon::poseidon_hash_span;
    use openzeppelin::account::interface;
    use starknet::account::Call;
    use core::pedersen::pedersen;
    use starknet::storage::Map;
    use starknet::syscalls::call_contract_syscall;
    use starknet::{
        ContractAddress,
        SyscallResultTrait,
        get_caller_address,
        get_contract_address,
        get_execution_info,
    };

    component!(path: AccountComponent, storage: account, event: AccountEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    const ERR_SESSION_EXPIRED: felt252 = 'ERR_SESSION_EXPIRED';
    const ERR_SESSION_INACTIVE: felt252 = 'ERR_SESSION_INACTIVE';
    const ERR_POLICY_CALLCAP: felt252 = 'ERR_POLICY_CALLCAP';
    const ERR_POLICY_SELECTOR_DENIED: felt252 = 'ERR_POLICY_SELECTOR_DENIED';
    const ERR_POLICY_TARGET_DENIED: felt252 = 'ERR_POLICY_TARGET_DENIED';
    const ERR_VALUE_LIMIT_EXCEEDED: felt252 = 'ERR_VALUE_LIMIT_EXCEEDED';
    const ERR_SESSION_NOT_READY: felt252 = 'ERR_SESSION_NOT_READY';
    const ERR_SESSION_TARGETS_LEN: felt252 = 'ERR_SESSION_TARGETS_LEN';
    const ERR_SESSION_SELECTORS_LEN: felt252 = 'ERR_SESSION_SELECTORS_LEN';
    const ERR_POLICY_CALLCOUNT_MISMATCH: felt252 = 'ERR_POLICY_CALLCOUNT_MISMATCH';
    const ERR_BAD_SESSION_NONCE: felt252 = 'ERR_BAD_SESSION_NONCE';
    const ERR_SESSION_SIG_INVALID: felt252 = 'ERR_SESSION_SIG_INVALID';
    const ERR_GUARDIAN_EXISTS: felt252 = 'ERR_GUARDIAN_EXISTS';
    const ERR_NOT_GUARDIAN: felt252 = 'ERR_NOT_GUARDIAN';
    const ERR_BAD_THRESHOLD: felt252 = 'ERR_BAD_THRESHOLD';
    const ERR_RECOVERY_IN_PROGRESS: felt252 = 'ERR_RECOVERY_IN_PROGRESS';
    const ERR_NO_RECOVERY: felt252 = 'ERR_NO_RECOVERY';
    const ERR_RECOVERY_MISMATCH: felt252 = 'ERR_RECOVERY_MISMATCH';
    const ERR_ALREADY_CONFIRMED: felt252 = 'ERR_ALREADY_CONFIRMED';
    const ERR_BEFORE_ETA: felt252 = 'ERR_BEFORE_ETA';
    const ERR_NOT_ENOUGH_CONFIRMS: felt252 = 'ERR_NOT_ENOUGH_CONFIRMS';
    const ERR_ZERO_OWNER: felt252 = 'ERR_ZERO_OWNER';
    const ERR_SAME_OWNER: felt252 = 'ERR_SAME_OWNER';
    const ERR_SIGNATURE_MISSING: felt252 = 'ERR_SIGNATURE_MISSING';
    const ERR_OWNER_SIG_INVALID: felt252 = 'ERR_OWNER_SIG_INVALID';
    const ERR_GUARDIAN_SIG_INVALID: felt252 = 'ERR_GUARDIAN_SIG_INVALID';
    const ERR_GUARDIAN_CALL_DENIED: felt252 = 'ERR_GUARDIAN_CALL_DENIED';
    const ERC20_TRANSFER_SEL: felt252 = 0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e;
    const APPLY_SESSION_USAGE_SELECTOR: felt252 = starknet::selector!("apply_session_usage");
    const PROPOSE_RECOVERY_SELECTOR: felt252 = starknet::selector!("propose_recovery");
    const CONFIRM_RECOVERY_SELECTOR: felt252 = starknet::selector!("confirm_recovery");
    const EXECUTE_RECOVERY_SELECTOR: felt252 = starknet::selector!("execute_recovery");

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
        guardians: LegacyMap<ContractAddress, bool>,
        guardian_count: u32,
        guardian_threshold: u8,
        recovery_delay: u64,
        recovery_active: bool,
        recovery_proposed_owner: felt252,
        recovery_eta: u64,
        recovery_confirms: LegacyMap<ContractAddress, bool>,
        recovery_confirm_count: u32,
        recovery_proposal_id: u64,
        recovery_guardian_last_confirm: LegacyMap<ContractAddress, u64>,
    }

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct SessionPolicy {
        pub is_active: bool,
        pub valid_after: u64,
        pub valid_until: u64,
        pub max_calls: u32,
        pub calls_used: u32,
        pub max_value_per_call: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SessionAdded {
        pub key_hash: felt252,
        pub valid_after: u64,
        pub valid_until: u64,
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

    #[derive(Drop, starknet::Event)]
    pub struct SessionNonceAdvanced {
        pub key_hash: felt252,
        pub new_nonce: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GuardianAdded {
        pub addr: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GuardianRemoved {
        pub addr: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ThresholdSet {
        pub threshold: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RecoveryDelaySet {
        pub delay: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnerRotated {
        pub new_owner: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RecoveryProposed {
        pub new_owner: felt252,
        pub eta: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RecoveryConfirmed {
        pub guardian: ContractAddress,
        pub new_owner: felt252,
        pub count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RecoveryCanceled {}

    #[derive(Drop, starknet::Event)]
    pub struct RecoveryExecuted {
        pub new_owner: felt252,
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
        SessionNonceAdvanced: SessionNonceAdvanced,
        GuardianAdded: GuardianAdded,
        GuardianRemoved: GuardianRemoved,
        ThresholdSet: ThresholdSet,
        RecoveryDelaySet: RecoveryDelaySet,
        OwnerRotated: OwnerRotated,
        RecoveryProposed: RecoveryProposed,
        RecoveryConfirmed: RecoveryConfirmed,
        RecoveryCanceled: RecoveryCanceled,
        RecoveryExecuted: RecoveryExecuted,
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

    fn get_block_timestamp() -> u64 {
        let execution_info = get_execution_info().unbox();
        execution_info.block_info.unbox().block_timestamp
    }

    fn derive_key_hash(key: felt252) -> felt252 {
        pedersen(key, 0)
    }

    fn assert_guardian(self: @ContractState, caller: ContractAddress) {
        let is_guardian = self.guardians.read(caller);
        assert(is_guardian == true, ERR_NOT_GUARDIAN);
    }

    fn _clear_recovery_state(ref self: ContractState) {
        self.recovery_active.write(false);
        self.recovery_proposed_owner.write(0_felt252);
        self.recovery_eta.write(0_u64);
        self.recovery_confirm_count.write(0_u32);
    }

    #[external(v0)]
    fn add_guardian(ref self: ContractState, addr: ContractAddress) {
        assert_owner();

        let exists = self.guardians.read(addr);
        assert(exists == false, ERR_GUARDIAN_EXISTS);

        self.guardians.write(addr, true);
        let new_count = self.guardian_count.read() + 1_u32;
        self.guardian_count.write(new_count);

        self.emit(Event::GuardianAdded(GuardianAdded { addr }));
    }

    #[external(v0)]
    fn remove_guardian(ref self: ContractState, addr: ContractAddress) {
        assert_owner();

        let exists = self.guardians.read(addr);
        assert(exists == true, ERR_NOT_GUARDIAN);

        self.guardians.write(addr, false);
        let current = self.guardian_count.read();
        let new_count = current - 1_u32;
        self.guardian_count.write(new_count);

        let threshold = self.guardian_threshold.read();
        let threshold_u32: u32 = threshold.into();
        assert(threshold_u32 <= new_count, ERR_BAD_THRESHOLD);

        self.emit(Event::GuardianRemoved(GuardianRemoved { addr }));
    }

    #[external(v0)]
    fn set_guardian_threshold(ref self: ContractState, threshold: u8) {
        assert_owner();

        let guardian_total = self.guardian_count.read();
        let threshold_u32: u32 = threshold.into();

        assert(threshold > 0_u8 && threshold_u32 <= guardian_total, ERR_BAD_THRESHOLD);

        self.guardian_threshold.write(threshold);
        self.emit(Event::ThresholdSet(ThresholdSet { threshold }));
    }

    #[external(v0)]
    fn set_recovery_delay(ref self: ContractState, delay: u64) {
        assert_owner();

        self.recovery_delay.write(delay);
        self.emit(Event::RecoveryDelaySet(RecoveryDelaySet { delay }));
    }

    #[external(v0)]
    fn propose_recovery(ref self: ContractState, new_owner: felt252) {
        let caller = get_caller_address();
        assert_guardian(@self, caller);

        let active = self.recovery_active.read();
        assert(active == false, ERR_RECOVERY_IN_PROGRESS);

        let now = get_block_timestamp();
        let eta = now + self.recovery_delay.read();

        let proposal_id = self.recovery_proposal_id.read() + 1_u64;
        self.recovery_proposal_id.write(proposal_id);

        self.recovery_active.write(true);
        self.recovery_proposed_owner.write(new_owner);
        self.recovery_eta.write(eta);
        self.recovery_confirm_count.write(0_u32);

        let last_confirm = self.recovery_guardian_last_confirm.read(caller);
        if last_confirm != proposal_id {
            self.recovery_confirms.write(caller, true);
            self.recovery_guardian_last_confirm.write(caller, proposal_id);
            self.recovery_confirm_count.write(1_u32);
            self.emit(
                Event::RecoveryConfirmed(RecoveryConfirmed {
                    guardian: caller,
                    new_owner,
                    count: 1_u32,
                }),
            );
        }

        self.emit(Event::RecoveryProposed(RecoveryProposed { new_owner, eta }));
    }

    #[external(v0)]
    fn confirm_recovery(ref self: ContractState, new_owner: felt252) {
        let caller = get_caller_address();
        assert_guardian(@self, caller);

        let active = self.recovery_active.read();
        assert(active == true, ERR_NO_RECOVERY);

        let proposed_owner = self.recovery_proposed_owner.read();
        assert(proposed_owner == new_owner, ERR_RECOVERY_MISMATCH);

        let proposal_id = self.recovery_proposal_id.read();
        let last_confirm = self.recovery_guardian_last_confirm.read(caller);

        if last_confirm != proposal_id {
            self.recovery_confirms.write(caller, false);
        }

        let already_confirmed = self.recovery_confirms.read(caller);
        assert(already_confirmed == false, ERR_ALREADY_CONFIRMED);

        self.recovery_confirms.write(caller, true);
        self.recovery_guardian_last_confirm.write(caller, proposal_id);

        let new_count = self.recovery_confirm_count.read() + 1_u32;
        self.recovery_confirm_count.write(new_count);

        self.emit(
            Event::RecoveryConfirmed(RecoveryConfirmed {
                guardian: caller,
                new_owner,
                count: new_count,
            }),
        );
    }

    #[external(v0)]
    fn cancel_recovery(ref self: ContractState) {
        assert_owner();

        let active = self.recovery_active.read();
        assert(active == true, ERR_NO_RECOVERY);

        _clear_recovery_state(ref self);

        self.emit(Event::RecoveryCanceled(RecoveryCanceled {}));
    }

    #[external(v0)]
    fn rotate_owner(ref self: ContractState, new_owner: felt252) {
        assert_owner();

        let active = self.recovery_active.read();
        assert(active == false, ERR_RECOVERY_IN_PROGRESS);

        assert(new_owner != 0_felt252, ERR_ZERO_OWNER);

        let current = self.owner_pubkey.read();
        assert(new_owner != current, ERR_SAME_OWNER);

        self.owner_pubkey.write(new_owner);
        self.emit(Event::OwnerRotated(OwnerRotated { new_owner }));
    }

    #[external(v0)]
    fn execute_recovery(ref self: ContractState) {
        let active = self.recovery_active.read();
        assert(active == true, ERR_NO_RECOVERY);

        let threshold = self.guardian_threshold.read();
        let threshold_u32: u32 = threshold.into();
        let confirms = self.recovery_confirm_count.read();
        assert(confirms >= threshold_u32, ERR_NOT_ENOUGH_CONFIRMS);

        let now = get_block_timestamp();
        let eta = self.recovery_eta.read();
        assert(now >= eta, ERR_BEFORE_ETA);

        let new_owner = self.recovery_proposed_owner.read();
        self.owner_pubkey.write(new_owner);

        _clear_recovery_state(ref self);

        self.emit(Event::OwnerRotated(OwnerRotated { new_owner }));
        self.emit(Event::RecoveryExecuted(RecoveryExecuted { new_owner }));
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
    fn add_session_with_allowlists(ref self: ContractState, session: Session) {
        assert_owner();

        let Session {
            pubkey,
            valid_after,
            valid_until,
            max_calls,
            value_cap,
            targets_len,
            targets,
            selectors_len,
            selectors,
        } = session;

        let declared_targets_len: usize = match targets_len.try_into() {
            Option::Some(value) => value,
            Option::None(_) => {
                assert(false, ERR_SESSION_TARGETS_LEN);
                0_usize
            },
        };
        let actual_targets_len = ArrayTrait::<ContractAddress>::len(@targets);
        require(actual_targets_len == declared_targets_len, ERR_SESSION_TARGETS_LEN);

        let declared_selectors_len: usize = match selectors_len.try_into() {
            Option::Some(value) => value,
            Option::None(_) => {
                assert(false, ERR_SESSION_SELECTORS_LEN);
                0_usize
            },
        };
        let actual_selectors_len = ArrayTrait::<felt252>::len(@selectors);
        require(actual_selectors_len == declared_selectors_len, ERR_SESSION_SELECTORS_LEN);

        let mut policy = SessionPolicy {
            is_active: false,
            valid_after,
            valid_until,
            max_calls,
            calls_used: 0_u32,
            max_value_per_call: value_cap,
        };

        self.add_session(pubkey, policy);

        let key_hash = derive_key_hash(pubkey);

        for target_ref in targets.span() {
            self.session_target_allow.write((key_hash, *target_ref), true);
        }

        for selector_ref in selectors.span() {
            self.session_selector_allow.write((key_hash, *selector_ref), true);
        }
    }

    #[external(v0)]
    fn apply_session_usage(
        ref self: ContractState,
        key_hash: felt252,
        prior_calls_used: u32,
        tx_call_count: u32,
        provided_nonce: u128,
    ) {
        let mut policy = self.session.read(key_hash);

        require(policy.is_active, ERR_SESSION_INACTIVE);

        let now = get_block_timestamp();
        require(now >= policy.valid_after, ERR_SESSION_NOT_READY);
        require(now <= policy.valid_until, ERR_SESSION_EXPIRED);

        require(policy.calls_used == prior_calls_used, ERR_POLICY_CALLCOUNT_MISMATCH);

        let updated_calls_used = checked_add_u32(policy.calls_used, tx_call_count);
        require(updated_calls_used <= policy.max_calls, ERR_POLICY_CALLCAP);

        let stored_nonce = self.session_nonce.read(key_hash);
        require(stored_nonce == provided_nonce, ERR_BAD_SESSION_NONCE);

        let new_nonce = provided_nonce + 1_u128;

        policy.calls_used = updated_calls_used;
        self.session.write(key_hash, policy);
        self.session_nonce.write(key_hash, new_nonce);

        self.emit(Event::SessionUsed(SessionUsed { key_hash, used: tx_call_count }));
        self.emit(Event::SessionNonceAdvanced(SessionNonceAdvanced { key_hash, new_nonce }));
    }

    #[abi(embed_v0)]
    impl SessionManagerImpl of ISessionManager<ContractState> {
        fn add_session(ref self: ContractState, key: felt252, mut policy: SessionPolicy) {
            assert_owner();

            assert(policy.valid_until > policy.valid_after, 'BAD_VALID_WINDOW');
            assert(policy.max_calls > 0_u32, 'BAD_MAX_CALLS');

            let key_hash = derive_key_hash(key);

            policy.is_active = true;
            policy.calls_used = 0_u32;

            self.session.write(key_hash, policy);
            self.session_nonce.write(key_hash, 0_u128);

            self.emit(Event::SessionAdded(SessionAdded {
                key_hash,
                valid_after: policy.valid_after,
                valid_until: policy.valid_until,
                max_calls: policy.max_calls,
            }));
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

    const MODE_OWNER: felt252 = 0;
    const MODE_SESSION: felt252 = 1;
    const MODE_GUARDIAN: felt252 = 2;
    const SESSION_DOMAIN_TAG: felt252 = 0x5541325f53455353494f4e5f5631;

    #[derive(Copy, Drop)]
    struct SessionValidation {
        key_hash: felt252,
        policy: SessionPolicy,
        tx_call_count: u32,
        provided_nonce: u128,
    }

    fn checked_add_u32(lhs: u32, rhs: u32) -> u32 {
        let sum = lhs + rhs;
        assert(sum >= lhs, ERR_POLICY_CALLCAP);
        sum
    }

    fn poseidon_chain(acc: felt252, value: felt252) -> felt252 {
        let mut values = array![acc, value];
        poseidon_hash_span(values.span())
    }

    fn hash_calldata(calldata: Span<felt252>) -> felt252 {
        let mut hash = 0_felt252;
        for item in calldata {
            hash = poseidon_chain(hash, *item);
        }

        hash
    }

    fn hash_call(call: Call) -> felt252 {
        let calldata_hash = hash_calldata(call.calldata);
        let selector_hash = poseidon_chain(call.selector, calldata_hash);
        let to_felt: felt252 = call.to.into();

        poseidon_chain(to_felt, selector_hash)
    }

    fn hash_calls(calls: @Array<Call>) -> felt252 {
        let mut digest = 0_felt252;

        for call_ref in calls.span() {
            let call_hash = hash_call(*call_ref);
            digest = poseidon_chain(digest, call_hash);
        }

        digest
    }

    fn combine_nonce_parts(low: u128, high: u128) -> u128 {
        let high_limit = 0x10000000000000000_u128;
        require(high < high_limit, ERR_BAD_SESSION_NONCE);
        require(low < high_limit, ERR_BAD_SESSION_NONCE);

        low + high * high_limit
    }

    fn extract_owner_signature(signature: Span<felt252>) -> Array<felt252> {
        let signature_len = signature.len();
        require(signature_len > 0_usize, ERR_SIGNATURE_MISSING);

        let first = *signature.at(0_usize);
        assert(first != MODE_SESSION && first != MODE_GUARDIAN, ERR_OWNER_SIG_INVALID);

        let mut start = 0_usize;
        if first == MODE_OWNER {
            start = 1_usize;
        }

        let min_len = start + 2_usize;
        require(signature_len >= min_len, ERR_OWNER_SIG_INVALID);

        let mut owner_signature = ArrayTrait::<felt252>::new();
        let mut i = start;
        while i < signature_len {
            owner_signature.append(*signature.at(i));
            i += 1_usize;
        }

        owner_signature
    }

    fn validate_guardian_authorization(
        self: @ContractState,
        signature: Span<felt252>,
        calls: @Array<Call>,
    ) {
        let signature_len = signature.len();
        require(signature_len == 2_usize, ERR_GUARDIAN_SIG_INVALID);

        let mode = *signature.at(0_usize);
        require(mode == MODE_GUARDIAN, ERR_GUARDIAN_SIG_INVALID);

        let guardian_felt = *signature.at(1_usize);
        let guardian_address: ContractAddress = match guardian_felt.try_into() {
            Option::Some(value) => value,
            Option::None(_) => {
                assert(false, ERR_GUARDIAN_SIG_INVALID);
                0.try_into().unwrap()
            },
        };

        let is_guardian = self.guardians.read(guardian_address);
        require(is_guardian == true, ERR_NOT_GUARDIAN);

        let calls_len = ArrayTrait::<Call>::len(calls);
        require(calls_len > 0_usize, ERR_GUARDIAN_CALL_DENIED);

        let contract_address = get_contract_address();

        for call_ref in calls.span() {
            let Call { to, selector, calldata: _ } = *call_ref;

            require(to == contract_address, ERR_GUARDIAN_CALL_DENIED);

            let allowed = selector == PROPOSE_RECOVERY_SELECTOR
                || selector == CONFIRM_RECOVERY_SELECTOR
                || selector == EXECUTE_RECOVERY_SELECTOR;
            require(allowed, ERR_GUARDIAN_CALL_DENIED);
        }
    }

    fn compute_session_message_hash(
        chain_id: felt252,
        account_felt: felt252,
        session_pubkey: felt252,
        key_hash: felt252,
        call_digest: felt252,
        valid_until: u64,
        nonce: u128,
    ) -> felt252 {
        let mut values = array![
            SESSION_DOMAIN_TAG,
            chain_id,
            account_felt,
            session_pubkey,
            key_hash,
            call_digest,
            valid_until.into(),
            nonce.into(),
        ];
        poseidon_hash_span(values.span())
    }

    fn validate_session_policy(
        self: @ContractState,
        signature: Span<felt252>,
        calls: @Array<Call>,
    ) -> SessionValidation {
        let signature_len = signature.len();
        require(signature_len >= 6_usize, ERR_SESSION_SIG_INVALID);

        let mode = *signature.at(0_usize);
        require(mode == MODE_SESSION, ERR_SESSION_SIG_INVALID);

        let session_key = *signature.at(1_usize);
        let key_hash = derive_key_hash(session_key);

        let nonce_low_felt = *signature.at(2_usize);
        let nonce_high_felt = *signature.at(3_usize);

        let nonce_low: u128 = match nonce_low_felt.try_into() {
            Option::Some(value) => value,
            Option::None(_) => {
                assert(false, ERR_BAD_SESSION_NONCE);
                0_u128
            },
        };

        let nonce_high: u128 = match nonce_high_felt.try_into() {
            Option::Some(value) => value,
            Option::None(_) => {
                assert(false, ERR_BAD_SESSION_NONCE);
                0_u128
            },
        };

        let provided_nonce = combine_nonce_parts(nonce_low, nonce_high);
        let policy = self.session.read(key_hash);

        require(policy.is_active, ERR_SESSION_INACTIVE);

        let now = get_block_timestamp();
        require(now >= policy.valid_after, ERR_SESSION_NOT_READY);
        require(now <= policy.valid_until, ERR_SESSION_EXPIRED);

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
                let limit = policy.max_value_per_call;

                if amount.high > limit.high {
                    assert(false, ERR_VALUE_LIMIT_EXCEEDED);
                } else if amount.high == limit.high {
                    assert(amount.low <= limit.low, ERR_VALUE_LIMIT_EXCEEDED);
                }
            }
        }

        let expected_nonce = self.session_nonce.read(key_hash);
        require(provided_nonce == expected_nonce, ERR_BAD_SESSION_NONCE);

        let call_digest = hash_calls(calls);

        let execution_info = get_execution_info().unbox();
        let chain_id = execution_info.tx_info.unbox().chain_id;
        let account_address = get_contract_address();
        let account_felt: felt252 = account_address.into();
        let message = compute_session_message_hash(
            chain_id,
            account_felt,
            session_key,
            key_hash,
            call_digest,
            policy.valid_until,
            provided_nonce,
        );

        let sig_r = *signature.at(4_usize);
        let sig_s = *signature.at(5_usize);

        let signature_valid = check_ecdsa_signature(message, session_key, sig_r, sig_s);
        require(signature_valid, ERR_SESSION_SIG_INVALID);

        SessionValidation { key_hash, policy, tx_call_count, provided_nonce }
    }

    #[abi(embed_v0)]
    impl AccountMixinImpl of interface::AccountABI<ContractState> {
        fn __execute__(self: @ContractState, calls: Array<Call>) {
            let tx_info = starknet::get_tx_info().unbox();
            let tx_hash = tx_info.transaction_hash;
            let signature = tx_info.signature;
            let signature_len = signature.len();
            require(signature_len > 0_usize, ERR_SIGNATURE_MISSING);

            let mode = *signature.at(0_usize);

            if mode == MODE_SESSION {
                let validation = validate_session_policy(self, signature, @calls);

                AccountComponent::AccountMixinImpl::<ContractState>::__execute__(self, calls);

                let mut accounting_calldata = ArrayTrait::<felt252>::new();
                accounting_calldata.append(validation.key_hash);
                accounting_calldata.append(validation.policy.calls_used.into());
                accounting_calldata.append(validation.tx_call_count.into());
                Serde::<u128>::serialize(@validation.provided_nonce, ref accounting_calldata);

                let _ = call_contract_syscall(
                    get_contract_address(),
                    APPLY_SESSION_USAGE_SELECTOR,
                    accounting_calldata.span(),
                )
                .unwrap_syscall();

                return;
            }

            if mode == MODE_GUARDIAN {
                validate_guardian_authorization(self, signature, @calls);
                AccountComponent::AccountMixinImpl::<ContractState>::__execute__(self, calls);
                return;
            }

            let owner_signature = extract_owner_signature(signature);
            let owner_signature_span = owner_signature.span();
            let owner_valid = AccountComponent::InternalImpl::<ContractState>::_is_valid_signature(
                self.account, tx_hash, owner_signature_span
            );

            require(owner_valid, ERR_OWNER_SIG_INVALID);

            AccountComponent::AccountMixinImpl::<ContractState>::__execute__(self, calls);
        }

        fn __validate__(self: @ContractState, calls: Array<Call>) -> felt252 {
            let tx_info = starknet::get_tx_info().unbox();
            let tx_hash = tx_info.transaction_hash;
            let signature = tx_info.signature;
            let signature_len = signature.len();
            require(signature_len > 0_usize, ERR_SIGNATURE_MISSING);

            let mode = *signature.at(0_usize);

            if mode == MODE_SESSION {
                let _validation = validate_session_policy(self, signature, @calls);
                return starknet::VALIDATED;
            }

            if mode == MODE_GUARDIAN {
                validate_guardian_authorization(self, signature, @calls);
                return starknet::VALIDATED;
            }

            let owner_signature = extract_owner_signature(signature);
            let owner_signature_span = owner_signature.span();
            let owner_valid = AccountComponent::InternalImpl::<ContractState>::_is_valid_signature(
                self.account, tx_hash, owner_signature_span
            );

            require(owner_valid, ERR_OWNER_SIG_INVALID);

            AccountComponent::AccountMixinImpl::<ContractState>::__validate__(self, calls)
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
