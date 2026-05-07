import { Config } from "@remotion/cli/config";
import { join } from "node:path";

Config.setOverwriteOutput(true);
Config.setPublicDir(join(process.cwd(), "video", "keating-intro", "public", "generated"));
Config.setVideoImageFormat("jpeg");
