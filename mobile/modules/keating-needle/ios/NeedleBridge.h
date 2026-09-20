#import <Foundation/Foundation.h>
NS_ASSUME_NONNULL_BEGIN
@interface NeedleBridge : NSObject
+ (BOOL)supported NS_SWIFT_NAME(supported());
+ (NSString *)runtimeRevision NS_SWIFT_NAME(runtimeRevision());
+ (nullable NSString *)modelIdentity NS_SWIFT_NAME(modelIdentity());
+ (NSString *)filename NS_SWIFT_NAME(filename());
+ (NSString *)modelSha NS_SWIFT_NAME(modelSha());
+ (NSInteger)modelSize NS_SWIFT_NAME(modelSize());
+ (nullable NSDictionary<NSString *, id> *)embedModel:(NSData *)model texts:(NSArray<NSString *> *)texts error:(NSError **)error NS_SWIFT_NAME(embed(model:texts:));
@end
NS_ASSUME_NONNULL_END
