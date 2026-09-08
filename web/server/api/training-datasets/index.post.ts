import { createError, defineEventHandler, setResponseStatus } from "h3";
import { getNotOrganicSessionAdapter } from "../../../src/notorganic-provider/server";
import { receiveTrainingDataset, TrainingDatasetError } from "../../utils/training-datasets";

export default defineEventHandler(async (event) => {
 try {
  const receipt = await receiveTrainingDataset(event.req, {
   storageDir: process.env.KEATING_TRAINING_DATASETS_STORAGE_DIR,
   resolveAccount: async () => {
    const session = await getNotOrganicSessionAdapter(event).getProductSession(event, { feature: "keating:training-datasets" });
    return session?.accountId ?? null;
   },
  });
  setResponseStatus(event, 201);
  return receipt;
 } catch (error) {
  if (error instanceof TrainingDatasetError) throw createError({ statusCode: error.statusCode, statusMessage: error.message });
  throw createError({ statusCode: 503, statusMessage: "Dataset sharing requires a configured server account session and persistent storage." });
 }
});
