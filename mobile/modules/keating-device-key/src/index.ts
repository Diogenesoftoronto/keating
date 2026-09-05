import { NativeModule, requireNativeModule } from "expo-modules-core";

export interface DevicePublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

declare class NativeKeatingDeviceKey extends NativeModule {
  getOrCreatePublicJwkAsync(alias: string): Promise<DevicePublicJwk>;
  signAsync(alias: string, payload: string): Promise<string>;
  deleteKeyAsync(alias: string): Promise<void>;
}

const native = requireNativeModule<NativeKeatingDeviceKey>("KeatingDeviceKey");

export const getOrCreatePublicJwkAsync = (alias: string) => native.getOrCreatePublicJwkAsync(alias);
export const signAsync = (alias: string, payload: string) => native.signAsync(alias, payload);
export const deleteKeyAsync = (alias: string) => native.deleteKeyAsync(alias);
