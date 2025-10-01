# UA² Contracts

This directory contains the Cairo contracts that back the UA² account. The project is managed with [Scarb](https://docs.swmansion.com/scarb/) and tests run using [Starknet Foundry](https://foundry-rs.github.io/starknet-foundry/).

## Prerequisites

- [Scarb](https://docs.swmansion.com/scarb/download.html)
- [Starknet Foundry](https://foundry-rs.github.io/starknet-foundry/getting-started/installation.html)

## Commands

```bash
# Build the contracts
scarb build

# Run the test suite
snforge test -q
```

Both commands can also be invoked from the repository root:

```bash
npm run contracts:build
npm run contracts:test
```
