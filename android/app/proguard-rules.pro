# App keep rules for the R8 release build (see android/app/build.gradle:
# minifyEnabled + proguard-android-optimize.txt + this file).
#
# Capacitor resolves plugin metadata BY REFLECTION at runtime: Bridge reads the
# @CapacitorPlugin annotation instance off each plugin class to answer
# permission-state queries (Bridge.getPermissionStates), index @PluginMethod
# entry points, and dispatch @PermissionCallback/@ActivityCallback results.
# Capacitor's own consumer rules keep the plugin CLASSES (@CapacitorPlugin
# classes and `* extends Plugin`), but NOT the annotation classes themselves —
# and AGP 8 runs R8 in "full mode", which drops runtime annotation data unless
# the annotation class is itself kept. That stripping crashed in production:
# NPE at Bridge.getPermissionStates (Bridge.java:1217) via the
# background-geolocation plugin's lifecycle hooks ("Unable to pause activity",
# patched around in patches/), and the same reflection path is hit by
# @capacitor/geolocation checkPermissions()/watchPosition() the moment the
# live-run tracker opens.
#
# Keep every Capacitor annotation class (and its members/defaults) so the
# runtime annotation instances survive on the kept plugin classes.
-keep class com.getcapacitor.annotation.** { *; }
-keep class com.getcapacitor.PluginMethod { *; }
-keep class com.getcapacitor.NativePlugin { *; }

# Make the runtime-annotation attributes explicit. proguard-android-optimize.txt
# already carries `-keepattributes *Annotation*`; this narrower list is restated
# here so the requirement survives any change to the default file. AnnotationDefault
# matters: @CapacitorPlugin's members have defaults (e.g. permissions() = {}),
# and reading an unset member with a stripped default throws.
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault
