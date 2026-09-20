import { defineEventHandler } from "h3";
import { handleJudgementGateway } from "../../../utils/judgement-gateway";

/** Authenticated Not Organic capability route; no direct provider-key bypass. */
export default defineEventHandler((event) => handleJudgementGateway(event));
