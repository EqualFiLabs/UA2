mod test_account_smoke;
mod test_sessions;
mod test_validate_allowlists;
mod test_validate_denials;
mod test_session_nonce_ok;
mod test_session_nonce_replay_and_mismatch;
mod test_guardians_admin;
mod test_recovery_happy;
mod test_recovery_edgecases;
mod test_owner_rotate;
mod test_rotate_vs_recovery;
mod test_validate_auth;

pub mod session_test_utils {
    use core::array::{Array, ArrayTrait};
    use core::result::Result;
    use core::traits::Into;
    use starknet::account::Call;
    use core::poseidon::poseidon_hash_span;
    use starknet::{ContractAddress, get_execution_info};
    use snforge_std::signature::KeyPair;
    use snforge_std::signature::stark_curve::{
        StarkCurveKeyPairImpl,
        StarkCurveSignerImpl,
    };
    use core::pedersen::pedersen;

    const SESSION_DOMAIN_TAG: felt252 = 0x5541325f53455353494f4e5f5631;
    const MODE_SESSION: felt252 = 1;
    const SESSION_PRIVATE_KEY: felt252 = 0x123456789ABCDEFFEDCBA987654321123456789ABCDEFFEDCBA987654321;

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

    fn split_nonce(nonce: u128) -> (felt252, felt252) {
        let base = 0x10000000000000000_u128;
        let high = nonce / base;
        let low = nonce - high * base;

        (low.into(), high.into())
    }

    fn compute_message(
        account_address: ContractAddress,
        key_hash: felt252,
        nonce: u128,
        calls: @Array<Call>,
    ) -> felt252 {
        let execution_info = get_execution_info().unbox();
        let chain_id = execution_info.tx_info.unbox().chain_id;
        let account_felt: felt252 = account_address.into();
        let call_digest = hash_calls(calls);

        let mut values = array![
            SESSION_DOMAIN_TAG,
            chain_id,
            account_felt,
            key_hash,
            nonce.into(),
            call_digest,
        ];
        poseidon_hash_span(values.span())
    }

    pub fn session_key() -> felt252 {
        session_keypair().public_key
    }

    pub fn session_key_hash() -> felt252 {
        pedersen(session_key(), 0)
    }

    fn session_keypair() -> KeyPair<felt252, felt252> {
        StarkCurveKeyPairImpl::from_secret_key(SESSION_PRIVATE_KEY)
    }

    pub fn build_session_signature(
        account_address: ContractAddress,
        session_pubkey: felt252,
        nonce: u128,
        calls: @Array<Call>,
    ) -> Array<felt252> {
        let key_hash = pedersen(session_pubkey, 0);
        let message = compute_message(account_address, key_hash, nonce, calls);
        let key_pair = session_keypair();
        let signature = StarkCurveSignerImpl::sign(key_pair, message);
        let (r, s) = match signature {
            Result::Ok(value) => value,
            Result::Err(_) => {
                assert(false, 'failed to sign message');
                (0, 0)
            },
        };

        let mut signature = ArrayTrait::<felt252>::new();
        signature.append(MODE_SESSION);
        signature.append(session_pubkey);
        let (nonce_low, nonce_high) = split_nonce(nonce);
        signature.append(nonce_low);
        signature.append(nonce_high);
        signature.append(r);
        signature.append(s);

        signature
    }
}
