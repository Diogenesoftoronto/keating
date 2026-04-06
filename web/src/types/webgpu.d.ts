interface GPUAdapter extends EventTarget {
  readonly features: GPUFeatureName[];
  readonly limits: GPUSupportedLimits;
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
}

interface GPUDeviceDescriptor {
  requiredFeatures?: GPUFeatureName[];
  requiredLimits?: Record<string, number>;
}

interface GPUFeatureName {
  name: string;
}

interface GPUSupportedLimits {
  maxTextureDimension1D: number;
  maxTextureDimension2D: number;
  maxTextureDimension3D: number;
  maxTextureArrayLayers: number;
  maxBindGroups: number;
  maxBindingsPerBindGroup: number;
  maxBufferSize: number;
  maxVertexBuffers: number;
  maxVertexAttributes: number;
}

interface GPUDevice extends EventTarget {}

interface Navigator {
  gpu: {
    requestAdapter(): Promise<GPUAdapter | null>;
  };
}
