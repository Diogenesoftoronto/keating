import { defineEventHandler } from "h3";
import { changeHabitRankings } from "../../../utils/habit-rankings-http";

export default defineEventHandler(changeHabitRankings);
