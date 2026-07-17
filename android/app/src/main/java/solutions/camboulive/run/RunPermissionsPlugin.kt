package solutions.camboulive.run

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

// Local plugin for the one run-recording runtime permission that neither
// @capacitor/geolocation nor @capacitor-community/background-geolocation requests:
// POST_NOTIFICATIONS (Android 13+). The background-geolocation foreground service
// shows an ongoing "recording run" notification, but on Android 13+ that
// notification is silently suppressed unless POST_NOTIFICATIONS is granted — so the
// user gets no visible indication a run is recording. This exposes a request for it.
//
// Deliberately narrow: background location is NOT handled here. Recording keeps
// working with the screen off via the foreground service under the "while using the
// app" grant, so the app never requests ACCESS_BACKGROUND_LOCATION (declaring it
// would trigger Google Play's background-location review for no gain).
@CapacitorPlugin(
    name = "RunPermissions",
    permissions = [
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
    ],
)
class RunPermissionsPlugin : Plugin() {

    // Below Android 13 there is no POST_NOTIFICATIONS runtime permission — the
    // foreground-service notification shows without one, so treat it as granted.
    private fun hasNotifications(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    @PluginMethod
    fun checkNotifications(call: PluginCall) {
        call.resolve(JSObject().put("granted", hasNotifications()))
    }

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (hasNotifications()) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback")
    }

    @PermissionCallback
    private fun notificationsCallback(call: PluginCall) {
        call.resolve(JSObject().put("granted", hasNotifications()))
    }
}
