package com.thisux.droidclaw.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.thisux.droidclaw.model.Workflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val WORKFLOWS_KEY = stringPreferencesKey("workflows_json")
private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

class WorkflowStore(private val context: Context) {

    val workflows: Flow<List<Workflow>> = context.dataStore.data.map { prefs ->
        val raw = prefs[WORKFLOWS_KEY] ?: "[]"
        try { json.decodeFromString<List<Workflow>>(raw) } catch (_: Exception) { emptyList() }
    }

    suspend fun save(workflow: Workflow) {
        context.dataStore.edit { prefs ->
            val list = currentList(prefs).toMutableList()
            val idx = list.indexOfFirst { it.id == workflow.id }
            if (idx >= 0) list[idx] = workflow else list.add(workflow)
            prefs[WORKFLOWS_KEY] = json.encodeToString(list)
        }
    }

    suspend fun delete(workflowId: String) {
        context.dataStore.edit { prefs ->
            val list = currentList(prefs).filter { it.id != workflowId }
            prefs[WORKFLOWS_KEY] = json.encodeToString(list)
        }
    }

    suspend fun replaceAll(workflows: List<Workflow>) {
        context.dataStore.edit { prefs ->
            prefs[WORKFLOWS_KEY] = json.encodeToString(workflows)
        }
    }

    private fun currentList(prefs: androidx.datastore.preferences.core.Preferences): List<Workflow> {
        val raw = prefs[WORKFLOWS_KEY] ?: "[]"
        return try { json.decodeFromString<List<Workflow>>(raw) } catch (_: Exception) { emptyList() }
    }
}
