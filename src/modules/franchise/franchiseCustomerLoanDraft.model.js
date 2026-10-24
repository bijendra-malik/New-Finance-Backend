const mongoose = require("mongoose");

const franchiseCustomerLoanDraftSchema = new mongoose.Schema(
  {
    franchise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
    },
    franchiseCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchiseCustomer",
      required: true,
      unique: true,
    },
    draftId: { type: String, required: true, unique: true },
    product: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

franchiseCustomerLoanDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

let persistentStorageMigration;

franchiseCustomerLoanDraftSchema.statics.ensureExpiryIndex = function () {
  if (!persistentStorageMigration) {
    persistentStorageMigration = (async () => {
      const collections = await this.db.db
        .listCollections({ name: this.collection.collectionName }, { nameOnly: true })
        .toArray();

      if (!collections.length) {
        await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        return;
      }

      const indexes = await this.collection.indexes();
      const expiryIndex = indexes.find(
        (index) => index.key?.expiresAt === 1 && typeof index.expireAfterSeconds === "number"
      );

      if (expiryIndex && expiryIndex.expireAfterSeconds !== 0) {
        await this.collection.dropIndex(expiryIndex.name);
      }

      await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

      const draftsWithoutExpiry = await this.collection
        .find({ expiresAt: { $exists: false } }, { projection: { _id: 1, createdAt: 1 } })
        .toArray();
      await Promise.all(
        draftsWithoutExpiry.map((draft) =>
          this.collection.updateOne(
            { _id: draft._id },
            {
              $set: {
                expiresAt: new Date(
                  (draft.createdAt ? new Date(draft.createdAt).getTime() : Date.now()) +
                    24 * 60 * 60 * 1000
                ),
              },
            }
          )
        )
      );
    })();
    persistentStorageMigration = persistentStorageMigration.catch((error) => {
      persistentStorageMigration = null;
      throw error;
    });
  }

  return persistentStorageMigration;
};

module.exports = mongoose.model("FranchiseCustomerLoanDraft", franchiseCustomerLoanDraftSchema);
