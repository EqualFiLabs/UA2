use core::array::{Array, ArrayTrait, SpanTrait};
use core::result::ResultTrait;
use core::serde::Serde;
use core::traits::{Into, TryInto};
use snforge_std::{
    cheat_caller_address,
    declare,
    spy_events,
    start_cheat_caller_address,
    start_cheat_signature,
    start_cheat_transaction_hash,
    stop_cheat_caller_address,
    stop_cheat_signature,
    stop_cheat_transaction_hash,
    CheatSpan,
    ContractClassTrait,
    DeclareResultTrait,
    EventSpyAssertionsTrait,
};
use snforge_std::signature::KeyPair;
use snforge_std::signature::stark_curve::{
    StarkCurveKeyPairImpl,
    StarkCurveSignerImpl,
};
use starknet::account::Call;
use starknet::syscalls::call_contract_syscall;
use starknet::{ContractAddress, SyscallResultTrait};
use ua2_contracts::ua2_account::UA2Account::{self, RecoveryDelaySet};

const MODE_OWNER: felt252 = 0;
const MODE_GUARDIAN: felt252 = 2;
const OWNER_PRIVATE_KEY: felt252 = 0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde;
const ERR_NO_RECOVERY: felt252 = 'ERR_NO_RECOVERY';
const ERR_GUARDIAN_CALL_DENIED: felt252 = 'ERR_GUARDIAN_CALL_DENIED';

fn owner_keypair() -> KeyPair<felt252, felt252> {
    StarkCurveKeyPairImpl::from_secret_key(OWNER_PRIVATE_KEY)
}

fn owner_pubkey() -> felt252 {
    owner_keypair().public_key
}

#[test]
fn owner_auth_allows_owner_call() {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let pubkey = owner_pubkey();
    let (account_address, _) = contract_class.deploy(@array![pubkey]).unwrap_syscall();

    let mut spy = spy_events();

    let delay = 42_u64;

    let mut calldata = array![];
    calldata.append(delay.into());
    let call = Call {
        to: account_address,
        selector: starknet::selector!("set_recovery_delay"),
        calldata: calldata.span(),
    };
    let mut calls = array![call];

    let tx_hash = 0x123456789abcdef_u128.into();

    let signature_tuple = match StarkCurveSignerImpl::sign(owner_keypair(), tx_hash) {
        core::result::Result::Ok(value) => value,
        core::result::Result::Err(_) => {
            assert(false, 'failed to sign owner tx');
            (0, 0)
        },
    };

    let (sig_r, sig_s) = signature_tuple;

    let mut signature = array![MODE_OWNER];
    signature.append(sig_r);
    signature.append(sig_s);

    start_cheat_transaction_hash(account_address, tx_hash);
    start_cheat_signature(account_address, signature.span());

    let zero_address: ContractAddress = 0.try_into().unwrap();
    start_cheat_caller_address(account_address, account_address);
    cheat_caller_address(account_address, zero_address, CheatSpan::TargetCalls(1));

    let mut execute_calldata = array![];
    Serde::<Array<Call>>::serialize(@calls, ref execute_calldata);
    call_contract_syscall(
        account_address,
        starknet::selector!("__execute__"),
        execute_calldata.span(),
    )
    .unwrap_syscall();

    stop_cheat_caller_address(account_address);
    stop_cheat_signature(account_address);
    stop_cheat_transaction_hash(account_address);

    spy.assert_emitted(@array![
        (
            account_address,
            UA2Account::Event::RecoveryDelaySet(RecoveryDelaySet { delay }),
        ),
    ]);
}

#[test]
fn guardian_mode_restricted_to_recovery_calls() {
    let declare_result = declare("UA2Account").unwrap();
    let contract_class = declare_result.contract_class();
    let (account_address, _) = contract_class.deploy(@array![owner_pubkey()]).unwrap_syscall();

    let guardian: ContractAddress = 0x111.try_into().unwrap();

    start_cheat_caller_address(account_address, account_address);
    let mut guardian_calldata = array![];
    guardian_calldata.append(guardian.into());
    call_contract_syscall(
        account_address,
        starknet::selector!("add_guardian"),
        guardian_calldata.span(),
    )
    .unwrap_syscall();
    stop_cheat_caller_address(account_address);

    let mut guardian_signature = array![MODE_GUARDIAN, guardian.into()];
    let zero: ContractAddress = 0.try_into().unwrap();

    start_cheat_caller_address(account_address, zero);
    start_cheat_signature(account_address, guardian_signature.span());

    let execute_call = Call {
        to: account_address,
        selector: starknet::selector!("execute_recovery"),
        calldata: array![].span(),
    };
    let mut execute_calls = array![execute_call];
    let mut execute_calldata = array![];
    Serde::<Array<Call>>::serialize(@execute_calls, ref execute_calldata);
    let execute_result = call_contract_syscall(
        account_address,
        starknet::selector!("__execute__"),
        execute_calldata.span(),
    );

    stop_cheat_signature(account_address);
    stop_cheat_caller_address(account_address);

    match execute_result {
        core::result::Result::Ok(_) => {
            assert(false, 'expected revert');
        },
        core::result::Result::Err(panic_data) => {
            let data = panic_data.span();
            assert(data.len() > 0_usize, 'missing panic data');
            let code = *data.at(0_usize);
            assert(code == ERR_NO_RECOVERY, 'unexpected revert reason');
        },
    }

    start_cheat_caller_address(account_address, zero);
    start_cheat_signature(account_address, guardian_signature.span());

    let mut threshold_calldata = array![];
    threshold_calldata.append(1.into());
    let threshold_call = Call {
        to: account_address,
        selector: starknet::selector!("set_guardian_threshold"),
        calldata: threshold_calldata.span(),
    };
    let mut threshold_calls = array![threshold_call];
    let mut threshold_payload = array![];
    Serde::<Array<Call>>::serialize(@threshold_calls, ref threshold_payload);
    let denied = call_contract_syscall(
        account_address,
        starknet::selector!("__execute__"),
        threshold_payload.span(),
    );

    stop_cheat_signature(account_address);
    stop_cheat_caller_address(account_address);

    match denied {
        core::result::Result::Ok(_) => {
            assert(false, 'expected revert');
        },
        core::result::Result::Err(panic_data) => {
            let data = panic_data.span();
            assert(data.len() > 0_usize, 'missing panic data');
            let code = *data.at(0_usize);
            assert(code == ERR_GUARDIAN_CALL_DENIED, 'guardian check failed');
        },
    }
}
