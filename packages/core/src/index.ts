import { connect as connectFn } from './connect';
import { limits, makeSessionsManager, guard, useSession, sessions as sessionHelpers } from './sessions';
import { toUint256, uint256ToHexParts } from './utils/u256';
import { toFelt, hexPadFelt } from './utils/felt';
import { withPaymaster, NoopPaymaster } from './paymasters';
import { paymasters, paymasterFrom } from './paymastersFactory';
import {
  UA2Error,
  ProviderUnavailableError,
  SessionExpiredError,
  PolicyViolationError,
  PaymasterDeniedError,
} from './errors';

export { connectFn as connect };
export type {
  UA2Client,
  ConnectOptions,
  WalletConnector,
  UA2AccountLike,
  Felt,
  Uint256,
  Session,
  SessionPolicyInput,
  SessionPolicyResolved,
  SessionPolicyStruct,
  SessionPolicyCalldata,
  SessionsManager,
  SessionUsage,
  SessionUseOptions,
  AccountCall,
  AccountTransaction,
  CallTransport,
  Paymaster,
  PaymasterContext,
  PaymasterRunner,
  SponsoredTx,
  SponsoredExecuteResult,
} from './types';

export { limits, makeSessionsManager, guard, useSession, sessionHelpers as sessions };
export { toUint256, uint256ToHexParts };
export { toFelt, hexPadFelt };
export { withPaymaster, NoopPaymaster };
export { paymasters, paymasterFrom };
export {
  UA2Error,
  ProviderUnavailableError,
  SessionExpiredError,
  PolicyViolationError,
  PaymasterDeniedError,
};

export const UA2 = {
  connect: connectFn,
  sessions: sessionHelpers,
  paymasters,
  errors: {
    UA2Error,
    ProviderUnavailableError,
    SessionExpiredError,
    PolicyViolationError,
    PaymasterDeniedError,
  },
};
