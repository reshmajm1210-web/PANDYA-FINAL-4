/* ==========================================================================
   PANDYA · Shared Wallet (coins + pearls)
   --------------------------------------------------------------------------
   One source of truth for the player's coins & pearls across EVERY page.
   It reads/writes the SAME localStorage key the 3D battle uses
   ("pandya.wallet"), so whatever you earn in a fight shows up on the map,
   the home screen, the story pages — everywhere.

   • Fresh players start with 100 coins and 50 pearls.
   • Any page can show the wallet by adding elements with the attributes
        data-wallet-coins   and   data-wallet-pearls
     (their text is kept in sync automatically).
   • Pages that have NO wallet markup get a small gold badge injected
     automatically in the top-right corner, so the coins & pearls are
     visible on all pages.

   This file only ADDS a display + storage helper. It does not change any
   existing game logic.
   ========================================================================== */

(function () {
  const KEY = 'pandya.wallet';
  const DEFAULT = { coins: 100, pearls: 50 };

  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && Number.isFinite(saved.coins) && Number.isFinite(saved.pearls)) {
        return { coins: saved.coins, pearls: saved.pearls };
      }
    } catch (e) {
      /* storage unavailable / corrupted → fall back to the default wallet */
    }
    return { ...DEFAULT };
  }

  function write(w) {
    try {
      localStorage.setItem(KEY, JSON.stringify(w));
    } catch (e) {
      /* private mode etc. — the wallet still lives for this session */
    }
  }

  let wallet = read();

  function fmt(n) {
    return Number(n).toLocaleString('en-IN');
  }

  function render() {
    document.querySelectorAll('[data-wallet-coins]').forEach((el) => {
      el.textContent = fmt(wallet.coins);
    });
    document.querySelectorAll('[data-wallet-pearls]').forEach((el) => {
      el.textContent = fmt(wallet.pearls);
    });
  }

  const api = {
    get() {
      return { ...wallet };
    },
    set({ coins, pearls } = {}) {
      if (Number.isFinite(coins)) wallet.coins = Math.max(0, Math.round(coins));
      if (Number.isFinite(pearls)) wallet.pearls = Math.max(0, Math.round(pearls));
      write(wallet);
      render();
      return api.get();
    },
    /** Increment the wallet — e.g. PandyaWallet.add(1000, 100) after a battle win. */
    add(coins = 0, pearls = 0) {
      wallet.coins += coins;
      wallet.pearls += pearls;
      write(wallet);
      render();
      return api.get();
    },
    reset() {
      wallet = { ...DEFAULT };
      write(wallet);
      render();
      return api.get();
    },
    refresh() {
      wallet = read();
      render();
      return api.get();
    },
  };

  window.PandyaWallet = api;

  function injectBadgeIfNeeded() {
    if (document.body.hasAttribute('data-wallet-hidden')) return;
    // If the page already shows the wallet somewhere, just sync those elements.
    if (document.querySelector('[data-wallet-coins],[data-wallet-pearls]')) {
      render();
      return;
    }
    // Otherwise drop a consistent gold badge in the top-right corner so the
    // coins & pearls are visible on this page too.
    const style = document.createElement('style');
    style.textContent = `
      #pandyaWalletBadge{
        position:fixed;
        top:14px;
        left:14px;
        display:flex;
        gap:8px;
        z-index:99999;
        font-family:Georgia,"Times New Roman",serif;
        pointer-events:none;
      }
      #pandyaWalletBadge .pw-chip{
        display:flex;
        align-items:center;
        gap:7px;
        padding:6px 13px;
        border-radius:22px;
        border:2px solid #80601f;
        background:linear-gradient(180deg,rgba(53,34,13,.96),rgba(15,9,4,.96));
        color:#f6d889;
        font-size:16px;
        font-weight:bold;
        box-shadow:0 4px 12px rgba(0,0,0,.7);
        line-height:1;
      }
      #pandyaWalletBadge .pw-ico{
        width:22px;
        height:22px;
        border-radius:50%;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:12px;
        font-weight:bold;
      }
      #pandyaWalletBadge .pw-coin .pw-ico{
        background:#d5a43a;color:#5a3507;border:2px solid #ffe28a;
      }
      #pandyaWalletBadge .pw-pearl .pw-ico{
        background:radial-gradient(circle at 35% 30%,#ffffff,#bfe3ff 55%,#7fb4e6);
        color:#2a4d70;border:2px solid #eaf6ff;
      }
      @media(max-width:800px){
        #pandyaWalletBadge{top:10px;left:10px;gap:6px;}
        #pandyaWalletBadge .pw-chip{font-size:13px;padding:5px 10px;}
        #pandyaWalletBadge .pw-ico{width:18px;height:18px;font-size:10px;}
      }
    `;
    document.head.appendChild(style);

    const badge = document.createElement('div');
    badge.id = 'pandyaWalletBadge';
    badge.innerHTML = `
      <div class="pw-chip pw-coin"><span class="pw-ico">C</span><span data-wallet-coins>0</span></div>
      <div class="pw-chip pw-pearl"><span class="pw-ico">◗</span><span data-wallet-pearls>0</span></div>
    `;
    document.body.appendChild(badge);
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBadgeIfNeeded);
  } else {
    injectBadgeIfNeeded();
  }

  // Keep pages in sync if another tab/page updates the wallet.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) api.refresh();
  });
})();
