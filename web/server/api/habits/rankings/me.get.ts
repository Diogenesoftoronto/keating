import { defineEventHandler } from "h3";
import { readPrivateHabitRankings } from "../../../utils/habit-rankings-http";

export default defineEventHandler(readPrivateHabitRankings);
