#import "NeedleBridge.h"
#import <TargetConditionals.h>
#include "needle_assets.h"
#if defined(__arm64__) || defined(__aarch64__)
#include "../cpp/NeedleEngine.hpp"
#endif
@implementation NeedleBridge
+ (BOOL)supported {
#if defined(__arm64__) || defined(__aarch64__)
  return YES;
#else
  return NO;
#endif
}
+ (NSString *)runtimeRevision { return @KEATING_NEEDLE_REVISION; }
+ (NSString *)filename { return @KEATING_NEEDLE_FILENAME; }
+ (NSString *)modelSha { return @KEATING_NEEDLE_MODEL_SHA; }
+ (NSInteger)modelSize { return KEATING_NEEDLE_MODEL_BYTES; }
+ (NSString *)modelIdentity {
#if defined(__arm64__) || defined(__aarch64__)
#if TARGET_OS_SIMULATOR
  return @KEATING_NEEDLE_ID_IOS_SIM_ARM64;
#else
  return @KEATING_NEEDLE_ID_IOS_ARM64;
#endif
#else
  return nil;
#endif
}
+ (NSDictionary<NSString *, id> *)embedModel:(NSData *)model texts:(NSArray<NSString *> *)texts error:(NSError **)error {
#if defined(__arm64__) || defined(__aarch64__)
  try {
    if (texts.count < 1 || texts.count > 16) throw std::runtime_error("Invalid Needle batch size.");
    std::vector<std::string> input;
    for (NSString *text in texts) {
      NSData *utf8 = [text dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
      if (!utf8 || utf8.length > 4096) throw std::runtime_error("Invalid Needle text.");
      input.emplace_back(static_cast<const char *>(utf8.bytes), utf8.length);
    }
    const auto result = keating_needle::embed(static_cast<const unsigned char *>(model.bytes), model.length, input);
    NSMutableArray *vectors = [NSMutableArray arrayWithCapacity:result.size()];
    for (const auto& vector : result) {
      NSMutableArray *row = [NSMutableArray arrayWithCapacity:vector.size()];
      for (float value : vector) [row addObject:@(value)];
      [vectors addObject:row];
    }
    return @{ @"model": [self modelIdentity], @"dimensions": @(result.front().size()), @"vectors": vectors };
  } catch (const std::exception& failure) {
    if (error) *error = [NSError errorWithDomain:@"KeatingNeedle" code:1 userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithUTF8String:failure.what()]}];
    return nil;
  }
#else
  if (error) *error = [NSError errorWithDomain:@"KeatingNeedle" code:2 userInfo:@{NSLocalizedDescriptionKey: @"Needle needs an ARM64 iOS device or simulator."}];
  return nil;
#endif
}
@end
