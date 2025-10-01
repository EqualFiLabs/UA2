#[contract]
mod dummy {
    #[view]
    fn ping() -> felt252 {
        'u' + 'a' + '2'
    }
}
