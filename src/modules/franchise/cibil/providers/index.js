const { cibilProviderName } = require("../../../../constants/cibil");

/*
==========================================
CIBIL provider registry.

Aaj sirf `mock` provider hai. Real bureau/aggregator add karne ka tareeka
EXACTLY yahi rahega:

  1. isi folder me `<provider>.provider.js` banao jo ye do export kare:
       name
       async fetchScore({ panNumber, fullName, mobile, dob })
     aur return kare: { success: true, score, bureau, referenceId }
                 ya:  { success: false, failureReason }
  2. use niche `PROVIDERS` map me register karo.
  3. .env me CIBIL_PROVIDER=<provider> set karo (credentials bhi .env me).

Ek bhi endpoint provider ke naam ko seedha call nahi karta — sirf
`cibil.service.js` provider se baat karta hai.
==========================================
*/

const PROVIDERS = {
  mock: require("./mock.provider"),
};

/** Configured provider deta hai; unknown hone par ek saaf error. */
const resolveProvider = () => {
  const name = cibilProviderName();
  const provider = PROVIDERS[name];

  if (!provider) {
    const error = new Error(
      `CIBIL provider "${name}" is not configured. Register it in src/modules/franchise/cibil/providers/index.js or set CIBIL_PROVIDER=mock for development.`
    );
    error.statusCode = 500;
    throw error;
  }

  return provider;
};

module.exports = { PROVIDERS, resolveProvider };
