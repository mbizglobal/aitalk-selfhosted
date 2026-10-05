import test from 'node:test'
import assert from 'node:assert/strict'
import { translations as en } from './agent-studio/en'
import { translations as ko } from './agent-studio/ko'
import { translations as de } from './agent-studio/de'
import { translations as fr } from './agent-studio/fr'

const base = Object.keys(en.en)

const KNOWN_MISSING: Record<'ko' | 'de' | 'fr', ReadonlySet<string>> = {
  ko: new Set(),
  de: new Set([
  'sms',
  'toolsSms',
  'add_sms',
  'loop_mode',
  'while_mode_desc',
  'foreach_mode_desc',
  'foreach_source',
  'foreach_item_var',
  'foreach_item_var_help',
  'foreach_max_help',
  'foreach_preview',
  'foreach_available_vars',
  'foreach_current_item',
  'foreach_current_index',
  'foreach_total_count',
  'foreach_imap_emails',
  'foreach_datasheet_rows',
  'foreach_json_items',
  'no_array_sources',
  'foreach_custom_path',
  'test_mode',
  'imap_result_info',
  'smtp_result_info',
  'telegram_result_info',
  'telegram_field_success',
  'telegram_field_message_id',
  'telegram_field_chat_id',
  'telegram_field_error',
  'telegram_start_result_info',
  'telegram_start_user_message',
  'telegram_var_message',
  'telegram_var_chat_id',
  'telegram_var_user_id',
  'telegram_var_username',
  'telegram_start_usage',
  'available_context_variables',
  'developer_info',
  'ai_assistant_example_whileTools_1',
  'ai_assistant_example_whileTools_2',
  'ai_assistant_example_whileTools_3',
  'batch_move',
  'batch_move_info',
  'batch_source',
  'batch_source_tooltip',
  'folder_mapping',
  'ai_prompt_example',
  'pstn_provider_korea',
  'pstn_provider_intl',
  'pstn_korea_add_title',
  'pstn_korea_number_label',
  'pstn_korea_detected',
  'pstn_clawops_apikey',
  'pstn_clawops_accountid',
  'pstn_clawops_creds_hint',
  'pstn_clawops_conn_title',
  'pstn_clawops_disconnect_blocked',
  'pstn_clawops_disconnect_confirm',
  'pstn_clawops_reprovision_failed',
  'pstn_acs_setup_needed',
  'pstn_korea_invalid',
  'pstn_korea_creds_required',
  ]),
  fr: new Set([
  'sms',
  'toolsSms',
  'add_sms',
  'loop_mode',
  'while_mode_desc',
  'foreach_mode_desc',
  'foreach_source',
  'foreach_item_var',
  'foreach_item_var_help',
  'foreach_max_help',
  'foreach_preview',
  'foreach_available_vars',
  'foreach_current_item',
  'foreach_current_index',
  'foreach_total_count',
  'foreach_imap_emails',
  'foreach_datasheet_rows',
  'foreach_json_items',
  'no_array_sources',
  'foreach_custom_path',
  'test_mode',
  'imap_result_info',
  'smtp_result_info',
  'telegram_result_info',
  'telegram_field_success',
  'telegram_field_message_id',
  'telegram_field_chat_id',
  'telegram_field_error',
  'telegram_start_result_info',
  'telegram_start_user_message',
  'telegram_var_message',
  'telegram_var_chat_id',
  'telegram_var_user_id',
  'telegram_var_username',
  'telegram_start_usage',
  'available_context_variables',
  'developer_info',
  'ai_assistant_example_whileTools_1',
  'ai_assistant_example_whileTools_2',
  'ai_assistant_example_whileTools_3',
  'batch_move',
  'batch_move_info',
  'batch_source',
  'batch_source_tooltip',
  'folder_mapping',
  'ai_prompt_example',
  'pstn_provider_korea',
  'pstn_provider_intl',
  'pstn_korea_add_title',
  'pstn_korea_number_label',
  'pstn_korea_detected',
  'pstn_clawops_apikey',
  'pstn_clawops_accountid',
  'pstn_clawops_creds_hint',
  'pstn_clawops_conn_title',
  'pstn_clawops_disconnect_blocked',
  'pstn_clawops_disconnect_confirm',
  'pstn_clawops_reprovision_failed',
  'pstn_acs_setup_needed',
  'pstn_korea_invalid',
  'pstn_korea_creds_required',
  ]),
}

for (const [lang, table] of [['ko', ko.ko], ['de', de.de], ['fr', fr.fr]] as const) {
  test(`Agent Studio translation: ${lang} has no newly missing keys`, () => {
    const keys = new Set(Object.keys(table as Record<string, string>))
    const missing = base.filter((k) => !keys.has(k))
    const fresh = missing.filter((k) => !KNOWN_MISSING[lang].has(k))
    assert.deepEqual(fresh, [], `${lang} 에 새로 빠진 키 — 그 언어에서만 빈칸이 된다. 넷 다 채우거나, 정말 못 채우면 KNOWN_MISSING 에 근거와 함께 추가한다`)
  })

  test(`Agent Studio translation: ${lang} has no stray keys that exist only there`, () => {
    const keys = Object.keys(table as Record<string, string>)
    const extra = keys.filter((k) => !base.includes(k))
    assert.deepEqual(extra, [], `${lang} 에만 있는 키 — 영어가 기준이라 아무도 못 본다(오타이기 쉽다)`)
  })

  test(`Agent Studio translation: ${lang} has no empty strings`, () => {
    const blank = Object.entries(table as Record<string, string>).filter(([, v]) => typeof v !== 'string' || !v.trim())
    assert.deepEqual(blank.map(([k]) => k), [], `${lang} 의 빈 문구 — 화면에 아무것도 안 나온다`)
  })
}

test('the English strings have no empty values; if the reference is empty the other checks lose their meaning entirely', () => {
  const blank = Object.entries(en.en as Record<string, string>).filter(([, v]) => typeof v !== 'string' || !v.trim())
  assert.deepEqual(blank.map(([k]) => k), [], '영어 문구가 비었다 — 네 언어 모두 빈칸이 된다')
})

test('the baseline has no keys that are missing in English too; a typo would become a dead entry that never gets caught', () => {
  for (const lang of ['ko', 'de', 'fr'] as const) {
    const ghost = [...KNOWN_MISSING[lang]].filter((k) => !base.includes(k))
    assert.deepEqual(ghost, [], `KNOWN_MISSING['${lang}'] 에 영어에 없는 키가 있다 — 오타이거나 지워진 키다`)
  }
})

test('🅿️ the baseline only shrinks; tells you if a translation was filled in but the list was not cleaned', () => {
  for (const [lang, table] of [['ko', ko.ko], ['de', de.de], ['fr', fr.fr]] as const) {
    const keys = new Set(Object.keys(table as Record<string, string>))
    const filled = [...KNOWN_MISSING[lang]].filter((k) => keys.has(k))
    assert.deepEqual(filled, [], `${lang} 에 이제 있는 키다 — KNOWN_MISSING['${lang}'] 에서 지운다`)
  }
})
