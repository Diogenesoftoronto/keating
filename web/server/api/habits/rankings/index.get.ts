import { defineEventHandler } from "h3";
import { readPublicHabitRankings } from "../../../utils/habit-rankings-http";

export default defineEventHandler(readPublicHabitRankings);
