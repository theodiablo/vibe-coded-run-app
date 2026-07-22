package solutions.camboulive.run

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ElevationGainedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant

// Reads finished exercise (run/walk) sessions from Android Health Connect, so a
// run recorded on a watch and synced there (e.g. by Garmin Connect on Android
// 14+) can be imported without the phone having tracked it. Everything is
// returned raw (metres, seconds, exercise-type id, ISO strings) — all
// interpretation lives in the pure TypeScript mapping layer (src/watch/mapping.ts).
//
// This is a local module plugin (not an npm package) so it lives beside the app's
// existing @pianissimoproject/capacitor-health-connect dependency without
// disturbing it — that plugin reads continuous heart rate; this one reads whole
// exercise sessions, which its record-type surface can't.
@CapacitorPlugin(name = "WatchImport")
class WatchImportPlugin : Plugin() {

    private val readPermissions = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(ElevationGainedRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
    )
    private val requestContract = PermissionController.createRequestPermissionResultContract()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    private fun client(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    @PluginMethod
    fun checkAvailability(call: PluginCall) {
        val status = try { HealthConnectClient.getSdkStatus(context) }
        catch (e: Exception) { HealthConnectClient.SDK_UNAVAILABLE }
        val availability = when (status) {
            HealthConnectClient.SDK_AVAILABLE -> "Available"
            // Strictly "installed but needs an update"; mapped to NotInstalled
            // because both resolve the same way for the user (Google Play shows
            // Update instead of Install) and the TS contract only acts on
            // "Available" vs not.
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "NotInstalled"
            else -> "NotSupported"
        }
        call.resolve(JSObject().put("availability", availability))
    }

    @PluginMethod
    fun checkHealthPermissions(call: PluginCall) {
        scope.launch {
            val granted = try { client().permissionController.getGrantedPermissions() }
            catch (e: Exception) { emptySet<String>() }
            call.resolve(JSObject().put("granted", granted.containsAll(readPermissions)))
        }
    }

    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        try {
            val intent = requestContract.createIntent(context, readPermissions)
            startActivityForResult(call, intent, "permsResult")
        } catch (e: Exception) {
            call.reject(e.message ?: "Couldn't open Health Connect permissions")
        }
    }

    @ActivityCallback
    fun permsResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val granted = try { requestContract.parseResult(result.resultCode, result.data) }
        catch (e: Exception) { emptySet<String>() }
        call.resolve(JSObject().put("granted", granted.containsAll(readPermissions)))
    }

    @PluginMethod
    fun readExerciseSessions(call: PluginCall) {
        val startStr = call.getString("startTime")
        val endStr = call.getString("endTime")
        if (startStr == null || endStr == null) {
            call.reject("startTime and endTime are required")
            return
        }
        scope.launch {
            try {
                val start = Instant.parse(startStr)
                val end = Instant.parse(endStr)
                val c = client()
                val filter = TimeRangeFilter.between(start, end)
                val sessions = JSArray()
                var pageToken: String? = null
                do {
                    val resp = c.readRecords(
                        ReadRecordsRequest(
                            recordType = ExerciseSessionRecord::class,
                            timeRangeFilter = filter,
                            pageToken = pageToken,
                        ),
                    )
                    for (rec in resp.records) {
                        sessions.put(sessionJson(c, rec))
                    }
                    pageToken = resp.pageToken
                } while (pageToken != null)
                call.resolve(JSObject().put("sessions", sessions))
            } catch (e: Exception) {
                call.reject(e.message ?: "Couldn't read exercise sessions")
            }
        }
    }

    // The raw per-sample heart-rate stream over a window, restricted to one data
    // origin (the app that wrote the session) so a second app syncing the same run
    // can't interleave its samples. Uses the already-granted HeartRateRecord read
    // permission (the aggregates in sessionJson already need it), so this adds no
    // new manifest scope or Play health-data declaration. Called lazily by the TS
    // import layer for NEW runs only. Health Connect has no GPS route for any
    // known writer, so there is deliberately no route read here (adding
    // READ_EXERCISE_ROUTES would force a Play re-declaration for data that doesn't
    // exist yet); revisit if a watch app starts writing ExerciseRoute.
    //   { startTime, endTime, dataOrigin? } → { samples: [{ bpm, t(ms epoch) }] }
    @PluginMethod
    fun readHeartRateSeries(call: PluginCall) {
        val startStr = call.getString("startTime")
        val endStr = call.getString("endTime")
        if (startStr == null || endStr == null) {
            call.reject("startTime and endTime are required")
            return
        }
        val origin = call.getString("dataOrigin")
        scope.launch {
            try {
                val start = Instant.parse(startStr)
                val end = Instant.parse(endStr)
                val c = client()
                val filter = TimeRangeFilter.between(start, end)
                val origins = if (origin != null) setOf(DataOrigin(origin)) else emptySet()
                val samples = JSArray()
                var pageToken: String? = null
                do {
                    val resp = c.readRecords(
                        ReadRecordsRequest(
                            recordType = HeartRateRecord::class,
                            timeRangeFilter = filter,
                            dataOriginFilter = origins,
                            pageToken = pageToken,
                        ),
                    )
                    for (rec in resp.records) {
                        for (s in rec.samples) {
                            val o = JSObject()
                            o.put("bpm", s.beatsPerMinute.toInt())
                            o.put("t", s.time.toEpochMilli())
                            samples.put(o)
                        }
                    }
                    pageToken = resp.pageToken
                } while (pageToken != null)
                call.resolve(JSObject().put("samples", samples))
            } catch (e: Exception) {
                call.reject(e.message ?: "Couldn't read heart rate series")
            }
        }
    }

    // Map one session + its aggregated metrics to a plain JSON object. Metrics are
    // aggregated over the session's own time window, restricted to the SAME data
    // origin that wrote the session — without the origin filter a time-window
    // aggregate mixes every app's records, so two apps both syncing the same run
    // (e.g. Garmin Connect and Zepp) could double distance. A failure leaves that
    // session's numbers null rather than dropping the session.
    private suspend fun sessionJson(c: HealthConnectClient, rec: ExerciseSessionRecord): JSObject {
        val o = JSObject()
        o.put("id", rec.metadata.id)
        o.put("dataOrigin", rec.metadata.dataOrigin.packageName)
        o.put("startTime", rec.startTime.toString())
        o.put("endTime", rec.endTime.toString())
        rec.startZoneOffset?.let { o.put("startZoneOffsetSec", it.totalSeconds) }
        o.put("exerciseType", rec.exerciseType)
        rec.title?.let { o.put("title", it) }
        try {
            val agg = c.aggregate(
                AggregateRequest(
                    metrics = setOf(
                        DistanceRecord.DISTANCE_TOTAL,
                        ElevationGainedRecord.ELEVATION_GAINED_TOTAL,
                        HeartRateRecord.BPM_AVG,
                        HeartRateRecord.BPM_MAX,
                        ExerciseSessionRecord.EXERCISE_DURATION_TOTAL,
                    ),
                    timeRangeFilter = TimeRangeFilter.between(rec.startTime, rec.endTime),
                    dataOriginFilter = setOf(rec.metadata.dataOrigin),
                ),
            )
            agg[DistanceRecord.DISTANCE_TOTAL]?.let { o.put("distanceM", it.inMeters) }
            agg[ElevationGainedRecord.ELEVATION_GAINED_TOTAL]?.let { o.put("elevationGainM", it.inMeters) }
            agg[HeartRateRecord.BPM_AVG]?.let { o.put("hrAvg", it.toInt()) }
            agg[HeartRateRecord.BPM_MAX]?.let { o.put("hrMax", it.toInt()) }
            agg[ExerciseSessionRecord.EXERCISE_DURATION_TOTAL]?.let { o.put("activeSec", it.seconds.toDouble()) }
        } catch (e: Exception) {
            // Aggregation unavailable for this session — leave its metrics unset.
        }
        return o
    }
}
