import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type WalletStatus = {
  chain_height: number | null;
  fully_scanned_height: number | null;
  total_zatoshis: number;
  spendable_zatoshis: number;
  pending_zatoshis: number;
  address_count: number;
};

type CreatedWallet = {
  recovery_phrase: string;
  address: string;
  birthday_height: number;
  chain_tip: number;
  secure_storage_saved: boolean;
};

const ZATOSHIS_PER_ZEC = 100_000_000;

function zec(zatoshis: number) {
  return (zatoshis / ZATOSHIS_PER_ZEC).toFixed(8);
}

function App() {
  const [walletExists, setWalletExists] = useState<boolean | null>(null);
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [restorePhrase, setRestorePhrase] = useState("");
  const [birthdayHeight, setBirthdayHeight] = useState("");
  const [nodeHeight, setNodeHeight] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendTxids, setSendTxids] = useState<string[]>([]);
  const [secureSecretAvailable, setSecureSecretAvailable] =
    useState<boolean | null>(null);

  async function refreshWallet() {
    try {
      const address = await invoke<string>("open_wallet");

      setWalletExists(true);

      const [walletStatus, walletAddresses] = await Promise.all([
        invoke<WalletStatus>("wallet_status"),
        invoke<string[]>("get_addresses"),
      ]);

      setStatus(walletStatus);
      setAddresses(
        walletAddresses.length > 0
          ? walletAddresses
          : address
          ? [address]
          : []
      );
    } catch {
      setWalletExists(false);
      setStatus(null);
      setAddresses([]);
    }
  }

  async function checkNode() {
    try {
      const height = await invoke<number>("check_lightwalletd");
      setNodeHeight(height);
    } catch (error) {
      setMessage(`Node unavailable: ${String(error)}`);
    }
  }

  useEffect(() => {
    refreshWallet();
    checkNode();

    invoke<boolean>("secure_secret_available")
      .then(setSecureSecretAvailable)
      .catch(() => setSecureSecretAvailable(false));
  }, []);

  async function createWallet() {
    setBusy(true);
    setMessage("");

    try {
      const created = await invoke<CreatedWallet>("create_wallet");

      setRecoveryPhrase(created.recovery_phrase);
      setWalletExists(true);

      await refreshWallet();

      setMessage("Wallet created successfully.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function restoreWallet() {
    if (!restorePhrase.trim()) {
      setMessage("Enter your recovery phrase.");
      return;
    }

    const parsedBirthday = Number(birthdayHeight);

    if (
      !Number.isInteger(parsedBirthday) ||
      parsedBirthday <= 0
    ) {
      setMessage(
        "Enter the wallet birthday block height."
      );
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      await invoke<string>(
        "restore_wallet_at_birthday",
        {
          recoveryPhrase: restorePhrase.trim(),
          birthdayHeight: parsedBirthday,
        }
      );

      setRestorePhrase("");
      setBirthdayHeight("");
      setWalletExists(true);

      await refreshWallet();

      setMessage(
        "Wallet restored from the supplied historical birthday."
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createAddress() {
    setBusy(true);
    setMessage("");

    try {
      const address = await invoke<string>("create_address");

      setAddresses((current) => [...current, address]);

      const walletStatus = await invoke<WalletStatus>("wallet_status");
      setStatus(walletStatus);

      setMessage("New Unified Address created.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendZec() {
    const recipient = sendRecipient.trim();
    const amount = Number(sendAmount);

    if (!recipient) {
      setMessage("Enter a recipient Zcash address.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Enter a valid ZEC amount greater than zero.");
      return;
    }

    if (
      status?.chain_height == null ||
      status?.fully_scanned_height == null ||
      status.fully_scanned_height < status.chain_height
    ) {
      setMessage(
        "Wallet synchronization must complete before sending ZEC."
      );
      return;
    }

    setBusy(true);
    setMessage("");
    setSendTxids([]);

    try {
      const txids = await invoke<string[]>("send_zec", {
        recipientAddress: recipient,
        amountZec: amount,
      });

      setSendTxids(txids);
      setSendRecipient("");
      setSendAmount("");

      await refreshWallet();

      setMessage(
        txids.length === 1
          ? "Transaction broadcast successfully."
          : `${txids.length} transactions broadcast successfully.`
      );
    } catch (error) {
      setMessage(`Send failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const walletFullyScanned =
    status?.chain_height != null &&
    status?.fully_scanned_height != null &&
    status.fully_scanned_height >= status.chain_height;

  if (walletExists === null) {
    return (
      <main className="app">
        <h1>ZOERDHUB Wallet</h1>
        <p>Opening wallet...</p>
      </main>
    );
  }

  if (!walletExists) {
    return (
      <main className="app">
        <section className="card hero">
          <h1>ZOERDHUB Wallet</h1>
          <p className="muted">
            Private Zcash wallet powered by Zebra and lightwalletd.
          </p>

          <button onClick={createWallet} disabled={busy}>
            {busy ? "Creating..." : "Create New Wallet"}
          </button>
        </section>

        <section className="card">
          <h2>Restore Wallet</h2>

          <textarea
            rows={5}
            value={restorePhrase}
            onChange={(e) => setRestorePhrase(e.target.value)}
            placeholder="Enter recovery phrase"
          />

          <input
            type="number"
            min="1"
            value={birthdayHeight}
            onChange={(e) => setBirthdayHeight(e.target.value)}
            placeholder="Wallet birthday block height"
            className="birthdayInput"
          />

          <button onClick={restoreWallet} disabled={busy}>
            Restore Account 0
          </button>

          <p className="warning">
            Enter the wallet's original birthday height, or a safe
            earlier height, so historical transactions can be scanned.
          </p>
        </section>

        {secureSecretAvailable !== null && (
          <div className="message">
            Secure recovery phrase stored:
            {" "}
            <strong>
              {secureSecretAvailable ? "YES" : "NO"}
            </strong>
          </div>
        )}

        {message && <div className="message">{message}</div>}
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>ZOERDHUB Wallet</h1>
          <p className="muted">Zcash Mainnet</p>
        </div>

        <button
          className="secondary"
          onClick={() => {
            refreshWallet();
            checkNode();
          }}
        >
          Refresh
        </button>
      </header>

      {recoveryPhrase && (
        <section className="card recovery">
          <h2>Recovery Phrase</h2>

          <p>
            Write this down offline. Do not share it with anyone.
          </p>

          <div className="phrase">{recoveryPhrase}</div>

          <button
            className="secondary"
            onClick={() => setRecoveryPhrase("")}
          >
            I Have Saved It
          </button>
        </section>
      )}

      <section className="grid">
        <article className="card">
          <span className="label">Total Balance</span>
          <strong className="balance">
            {status ? zec(status.total_zatoshis) : "0.00000000"} ZEC
          </strong>
        </article>

        <article className="card">
          <span className="label">Spendable</span>
          <strong>
            {status ? zec(status.spendable_zatoshis) : "0.00000000"} ZEC
          </strong>
        </article>

        <article className="card">
          <span className="label">Pending</span>
          <strong>
            {status ? zec(status.pending_zatoshis) : "0.00000000"} ZEC
          </strong>
        </article>
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <h2>Send</h2>
            <p className="muted">
              Send ZEC from Account 0
            </p>
          </div>
        </div>

        <div className="sendForm">
          <label>
            <span className="label">Recipient</span>

            <input
              type="text"
              value={sendRecipient}
              onChange={(e) =>
                setSendRecipient(e.target.value)
              }
              placeholder="Unified or supported Zcash address"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label>
            <span className="label">Amount</span>

            <div className="amountInput">
              <input
                type="number"
                min="0"
                step="0.00000001"
                value={sendAmount}
                onChange={(e) =>
                  setSendAmount(e.target.value)
                }
                placeholder="0.00000000"
              />

              <span>ZEC</span>
            </div>
          </label>

          <button
            onClick={sendZec}
            disabled={busy || !walletFullyScanned}
          >
            {busy ? "Processing..." : "Send ZEC"}
          </button>
        </div>

        {!walletFullyScanned && (
          <p className="warning">
            Sending is locked until this wallet has fully
            synchronized with the backing Zcash node.
          </p>
        )}

        {sendTxids.length > 0 && (
          <div className="sendResult">
            <strong>Transaction ID</strong>

            {sendTxids.map((txid) => (
              <code key={txid}>{txid}</code>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Synchronization</h2>

        <div className="statusRows">
          <span>lightwalletd / Zebra height</span>
          <strong>{nodeHeight ?? "Unavailable"}</strong>

          <span>Wallet chain height</span>
          <strong>{status?.chain_height ?? "Unknown"}</strong>

          <span>Fully scanned height</span>
          <strong>{status?.fully_scanned_height ?? "Not scanned"}</strong>
        </div>

        <p className="warning">
          The backing Zebra node is still catching up to current Zcash
          mainnet. Do not fund this development wallet yet.
        </p>
      </section>

      <section className="card">
        <div className="sectionHeader">
          <div>
            <h2>Receive</h2>
            <p className="muted">
              Unified Addresses for Zcash Account 0
            </p>
          </div>

          <button onClick={createAddress} disabled={busy}>
            + New Address
          </button>
        </div>

        <div className="addresses">
          {addresses.map((address, index) => (
            <div className="address" key={`${address}-${index}`}>
              <strong>
                {index === 0 ? "Main" : `Address ${index + 1}`}
              </strong>

              <code>{address}</code>

              <button
                className="secondary small"
                onClick={() => navigator.clipboard.writeText(address)}
              >
                Copy
              </button>
            </div>
          ))}
        </div>
      </section>

      {message && <div className="message">{message}</div>}
    </main>
  );
}

export default App;
