// Browser bundle for NEAR wallets. Build with: npm run build:wallet
// Exposes window.NearWallet = { setup }.
import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupHereWallet } from '@near-wallet-selector/here-wallet';
import { setupHotWallet } from '@near-wallet-selector/hot-wallet';
import { setupIntearWallet } from '@near-wallet-selector/intear-wallet';
import { Buffer } from 'buffer';

export async function setup(network = 'mainnet') {
  const selector = await setupWalletSelector({
    network,
    modules: [setupMeteorWallet(), setupHotWallet(), setupIntearWallet(), setupHereWallet(), setupMyNearWallet()],
  });
  return { selector, Buffer };
}
