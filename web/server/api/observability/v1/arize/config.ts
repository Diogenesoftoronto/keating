import { defineEventHandler } from "h3";
import { publicArizeConfig } from "../../../../utils/arize-observability";

export default defineEventHandler(() => publicArizeConfig());
