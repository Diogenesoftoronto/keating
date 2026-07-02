import type { IconType } from "react-icons";
import { FaWindows } from "react-icons/fa";
import { SiAndroid, SiApple, SiLinux } from "react-icons/si";

/**
 * Real platform logos from react-icons.
 * User preference: use logos from a library or fetched online rather than
 * custom approximations.
 */
export type PlatformLogo = IconType;

export const AppleLogo: PlatformLogo = SiApple;
export const MacLogo: PlatformLogo = SiApple;
export const WindowsLogo: PlatformLogo = FaWindows;
export const LinuxLogo: PlatformLogo = SiLinux;
export const AndroidLogo: PlatformLogo = SiAndroid;
export const IosLogo: PlatformLogo = SiApple;
