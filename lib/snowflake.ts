import axios from 'axios';

const DB = 'CORTEX_TESTING.PUBLIC';

interface SnowflakeQueryOptions {
  database?: string;
  schema?: string;
  warehouse?: string;
}

export class SnowflakeClient {
  private account: string;
  private warehouse: string;
  private pat: string;

  constructor() {
    this.account = process.env.SNOWFLAKE_ACCOUNT || '';
    this.warehouse = process.env.SNOWFLAKE_WAREHOUSE || '';
    this.pat = process.env.SNOWFLAKE_PAT || process.env.SNOWFLAKE_PASSWORD || '';

    if (!this.account || !this.warehouse || !this.pat) {
      throw new Error('Missing required Snowflake env vars: SNOWFLAKE_ACCOUNT, SNOWFLAKE_WAREHOUSE, SNOWFLAKE_PAT');
    }
  }

  private get baseURL(): string {
    return `https://${this.account}.snowflakecomputing.com/api/v2`;
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.pat}`,
    };
  }

  private parseResponse(responseData: any): any[] {
    const rows = responseData.data;
    const rowType = responseData.resultSetMetaData?.rowType;

    if (!rows || !rowType) return [];

    // Snowflake returns data as array of arrays — map to named objects using rowType
    return rows.map((row: any[]) => {
      const obj: Record<string, any> = {};
      rowType.forEach((col: any, i: number) => {
        obj[col.name] = row[i];
      });
      return obj;
    });
  }

  async executeQuery(sql: string, options: SnowflakeQueryOptions = {}): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseURL}/statements`,
        {
          statement: sql,
          database: options.database || 'CORTEX_TESTING',
          schema: options.schema || 'PUBLIC',
          warehouse: options.warehouse || this.warehouse,
        },
        { headers: this.headers }
      );

      // Snowflake returns code "090001" for synchronous success
      if (response.data?.code === '090001' && response.data?.data) {
        return this.parseResponse(response.data);
      }

      // Otherwise poll for results
      const statementId = response.data.statementHandle;
      if (!statementId) {
        throw new Error('No statementHandle returned from Snowflake');
      }

      return await this.pollForResults(statementId);
    } catch (error: any) {
      console.error('Snowflake query error - response body:', JSON.stringify(error?.response?.data));
      console.error('Snowflake query error - SQL:', sql);
      throw error;
    }
  }

  private async pollForResults(
    statementId: string,
    maxAttempts: number = 60,
    delayMs: number = 500
  ): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await axios.get(
        `${this.baseURL}/statements/${statementId}`,
        { headers: this.headers }
      );

      const { code, data, message } = response.data;

      if (code === '090001' && data) {
        return this.parseResponse(response.data);
      }

      if (code === '000604') {
        throw new Error(message || 'Query execution failed');
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error('Query execution timeout');
  }

  // ─── SYNTHETIC_PHYSICIAN_CHARS ───────────────────────────────────────────

  async queryAllPhysicians(): Promise<any[]> {
    return await this.executeQuery(`
      SELECT
        PHYSICIAN_ID,
        PHYSICIAN_FIRST_NAME,
        PHYSICIAN_LAST_NAME,
        PHYSICIAN_SPECIALTY,
        PHYSICIAN_ADDRESS_LINE_1,
        PHYSICIAN_CITY,
        PHYSICIAN_STATE,
        PHYSICIAN_ZIP_CODE,
        PHYSICIAN_YEARS_IN_PRACTICE,
        SALES_GEOGRAPHY
      FROM ${DB}.SYNTHETIC_PHYSICIAN_CHARS
      ORDER BY PHYSICIAN_LAST_NAME, PHYSICIAN_FIRST_NAME
    `);
  }

  async queryPhysiciansByUser(userId: string): Promise<any[]> {
    return await this.executeQuery(`
      SELECT DISTINCT
        p.PHYSICIAN_ID,
        p.PHYSICIAN_FIRST_NAME,
        p.PHYSICIAN_LAST_NAME,
        p.PHYSICIAN_SPECIALTY,
        p.PHYSICIAN_ADDRESS_LINE_1,
        p.PHYSICIAN_CITY,
        p.PHYSICIAN_STATE,
        p.PHYSICIAN_ZIP_CODE,
        p.PHYSICIAN_YEARS_IN_PRACTICE,
        p.SALES_GEOGRAPHY
      FROM ${DB}.SYNTHETIC_PHYSICIAN_CHARS p
      INNER JOIN ${DB}.SYNTHETIC_REP_TARGETS srt ON p.PHYSICIAN_ID = srt.PHYSICIAN_ID
      WHERE srt.USER_ID = '${userId}'
      ORDER BY p.PHYSICIAN_LAST_NAME, p.PHYSICIAN_FIRST_NAME
    `);
  }

  async queryPhysicianById(physicianId: string): Promise<any> {
    const results = await this.executeQuery(`
      SELECT
        p.PHYSICIAN_ID,
        p.PHYSICIAN_FIRST_NAME,
        p.PHYSICIAN_LAST_NAME,
        p.PHYSICIAN_SPECIALTY,
        p.PHYSICIAN_ADDRESS_LINE_1,
        p.PHYSICIAN_CITY,
        p.PHYSICIAN_STATE,
        p.PHYSICIAN_ZIP_CODE,
        p.PHYSICIAN_YEARS_IN_PRACTICE,
        p.SALES_GEOGRAPHY,
        ps.SEGMENT_NAME,
        ps.ATTITUDINAL_DESCRIPTION,
        ps.TREATMENT_PREFERENCES
      FROM ${DB}.SYNTHETIC_PHYSICIAN_CHARS p
      LEFT JOIN ${DB}.SYNTHETIC_PHYSICIAN_SEGMENT ps ON p.PHYSICIAN_ID = ps.PHYSICIAN_ID
      WHERE p.PHYSICIAN_ID = '${physicianId}'
      LIMIT 1
    `);
    return results?.[0] ?? null;
  }

  // ─── SYNTHETIC_PHYSICIAN_SEGMENT ─────────────────────────────────────────

  async queryPhysicianSegment(physicianId: string): Promise<any> {
    const results = await this.executeQuery(`
      SELECT PHYSICIAN_ID, SEGMENT_NAME, ATTITUDINAL_DESCRIPTION, TREATMENT_PREFERENCES
      FROM ${DB}.SYNTHETIC_PHYSICIAN_SEGMENT
      WHERE PHYSICIAN_ID = '${physicianId}'
      LIMIT 1
    `);
    return results?.[0] ?? null;
  }

  // ─── SYNTHETIC_ACTIVITY ──────────────────────────────────────────────────

  async queryActivityByPhysician(physicianId: string): Promise<any[]> {
    return await this.executeQuery(`
      SELECT PHYSICIAN_ID, TRANSACTION_DATE, PROMOTION_CHANNEL, MESSAGE_DELIVERED
      FROM ${DB}.SYNTHETIC_ACTIVITY
      WHERE PHYSICIAN_ID = '${physicianId}'
      ORDER BY TRANSACTION_DATE DESC
    `);
  }

  // ─── SYNTHETIC_RX ────────────────────────────────────────────────────────

  async queryRxByPhysician(physicianId: string): Promise<any[]> {
    return await this.executeQuery(`
      SELECT PHYSICIAN_ID, FRIDAY_WEEK_ENDING_DATE, BRAND, PRESCRIPTIONS_WRITTEN
      FROM ${DB}.SYNTHETIC_RX
      WHERE PHYSICIAN_ID = '${physicianId}'
      ORDER BY FRIDAY_WEEK_ENDING_DATE DESC
    `);
  }

  // ─── SYNTHETIC_REP_TARGETS ───────────────────────────────────────────────

  async queryEvaluationHistory(appUserId: string, physicianId: string): Promise<any[]> {
    const sql = `
      SELECT
        EVALUATED_AT, OVERALL_SCORE,
        CLINICAL_KNOWLEDGE_SCORE, OBJECTION_HANDLING_SCORE,
        COMPLIANCE_SCORE, TONE_RAPPORT_SCORE, CLOSING_SCORE
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = '${appUserId}' AND PHYSICIAN_ID = '${physicianId}'
      ORDER BY EVALUATED_AT ASC
    `;
    return await this.executeQuery(sql);
  }

  async queryEvaluationHistoryAllPhysicians(appUserId: string): Promise<any[]> {
    const sql = `
      SELECT
        EVALUATED_AT::DATE AS EVALUATED_AT,
        MEDIAN(OVERALL_SCORE) AS OVERALL_SCORE,
        MEDIAN(CLINICAL_KNOWLEDGE_SCORE) AS CLINICAL_KNOWLEDGE_SCORE,
        MEDIAN(OBJECTION_HANDLING_SCORE) AS OBJECTION_HANDLING_SCORE,
        MEDIAN(COMPLIANCE_SCORE) AS COMPLIANCE_SCORE,
        MEDIAN(TONE_RAPPORT_SCORE) AS TONE_RAPPORT_SCORE,
        MEDIAN(CLOSING_SCORE) AS CLOSING_SCORE
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = '${appUserId}'
      GROUP BY EVALUATED_AT::DATE
      ORDER BY EVALUATED_AT::DATE ASC
    `;
    return await this.executeQuery(sql);
  }

  async querySegmentMedianScores(segmentName: string): Promise<any[]> {
    const sql = `
      SELECT
        EVALUATED_AT::DATE AS EVALUATED_AT,
        MEDIAN(OVERALL_SCORE) AS OVERALL_SCORE,
        MEDIAN(CLINICAL_KNOWLEDGE_SCORE) AS CLINICAL_KNOWLEDGE_SCORE,
        MEDIAN(OBJECTION_HANDLING_SCORE) AS OBJECTION_HANDLING_SCORE,
        MEDIAN(COMPLIANCE_SCORE) AS COMPLIANCE_SCORE,
        MEDIAN(TONE_RAPPORT_SCORE) AS TONE_RAPPORT_SCORE,
        MEDIAN(CLOSING_SCORE) AS CLOSING_SCORE
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE SEGMENT_NAME = '${segmentName}'
      GROUP BY EVALUATED_AT::DATE
      ORDER BY EVALUATED_AT::DATE ASC
    `;
    return await this.executeQuery(sql);
  }

  async queryLatestEvaluationByAppUser(appUserId: string): Promise<any> {
    const sql = `
      SELECT
        USER_ID, USER_NAME, APP_USER_ID, EVALUATION_ID, EVALUATED_AT,
        SEGMENT_NAME, PHYSICIAN_ID, PHYSICIAN_FIRST_NAME, PHYSICIAN_LAST_NAME,
        OVERALL_SCORE, FIELD_READINESS, COACHING_PRIORITY, RECOMMENDATIONS,
        CLINICAL_KNOWLEDGE_SCORE, CLINICAL_KNOWLEDGE_RATIONALE,
        CK_C1, CK_C2, CK_C3, CK_C4, CK_C5, CK_C6, CK_C7, CK_C8,
        OBJECTION_HANDLING_SCORE, OBJECTION_HANDLING_RATIONALE,
        OH_OBJECTION_COUNT, OH_OBJECTION_DETAILS,
        COMPLIANCE_SCORE, COMPLIANCE_RATIONALE,
        COMP_K1, COMP_K2, COMP_K3, COMP_K4, COMP_K5, COMP_K6,
        TONE_RAPPORT_SCORE, TONE_RAPPORT_RATIONALE,
        TR_T1, TR_T2, TR_T3, TR_T4, TR_T5, TR_T6, TR_T7,
        TR_PROFESSIONALISM_SUB_SCORE, TR_RAPPORT_SUB_SCORE,
        CLOSING_SCORE, CLOSING_RATIONALE,
        CL_L1, CL_L2, CL_L3, CL_L4, CL_L5, CL_L6,
        CL_ACTIVE_CLOSING_SCORE, CL_CONTENT_CLOSING_CREDIT
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE APP_USER_ID = '${appUserId}'
      ORDER BY EVALUATED_AT DESC
      LIMIT 1
    `;
    const results = await this.executeQuery(sql);
    return results?.[0] ?? null;
  }

  async queryLatestEvaluation(userId: string): Promise<any> {
    const sql = `
      SELECT
        USER_ID, USER_NAME, EVALUATION_ID, EVALUATED_AT,
        SEGMENT_NAME, PHYSICIAN_ID, PHYSICIAN_FIRST_NAME, PHYSICIAN_LAST_NAME,
        OVERALL_SCORE, FIELD_READINESS, COACHING_PRIORITY, RECOMMENDATIONS,
        CLINICAL_KNOWLEDGE_SCORE, CLINICAL_KNOWLEDGE_RATIONALE,
        CK_C1, CK_C2, CK_C3, CK_C4, CK_C5, CK_C6, CK_C7, CK_C8,
        OBJECTION_HANDLING_SCORE, OBJECTION_HANDLING_RATIONALE,
        OH_OBJECTION_COUNT, OH_OBJECTION_DETAILS,
        COMPLIANCE_SCORE, COMPLIANCE_RATIONALE,
        COMP_K1, COMP_K2, COMP_K3, COMP_K4, COMP_K5, COMP_K6,
        TONE_RAPPORT_SCORE, TONE_RAPPORT_RATIONALE,
        TR_T1, TR_T2, TR_T3, TR_T4, TR_T5, TR_T6, TR_T7,
        TR_PROFESSIONALISM_SUB_SCORE, TR_RAPPORT_SUB_SCORE,
        CLOSING_SCORE, CLOSING_RATIONALE,
        CL_L1, CL_L2, CL_L3, CL_L4, CL_L5, CL_L6,
        CL_ACTIVE_CLOSING_SCORE, CL_CONTENT_CLOSING_CREDIT
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      WHERE USER_ID = '${userId}'
      ORDER BY EVALUATED_AT DESC
      LIMIT 1
    `;
    const results = await this.executeQuery(sql);
    return results?.[0] ?? null;
  }

  async queryRepTargets(userId: string): Promise<any[]> {
    return await this.executeQuery(`
      SELECT PHYSICIAN_ID, USER_ID, ASSIGNED_AT, ASSIGNED_BY
      FROM ${DB}.SYNTHETIC_REP_TARGETS
      WHERE USER_ID = '${userId}'
    `);
  }

  // ─── AUTH ─────────────────────────────────────────────────────────────────

  async getUserByUsername(username: string): Promise<any> {
    const results = await this.executeQuery(`
      SELECT USER_ID, USERNAME, PASSWORD_HASH, EMAIL
      FROM ${DB}.USERS
      WHERE USERNAME = '${username}'
      LIMIT 1
    `);
    return results?.[0] ?? null;
  }

  async createUser(userId: string, username: string, passwordHash: string, email: string): Promise<void> {
    await this.executeQuery(`
      INSERT INTO ${DB}.USERS (USER_ID, USERNAME, PASSWORD_HASH, EMAIL)
      VALUES ('${userId}', '${username}', '${passwordHash}', '${email}')
    `);
  }

  async saveConversationMessage(
    conversationId: string,
    userId: string,
    physicianId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    await this.executeQuery(`
      INSERT INTO ${DB}.CONVERSATION_HISTORY (CONVERSATION_ID, USER_ID, PHYSICIAN_ID, MESSAGE_ROLE, MESSAGE_CONTENT)
      VALUES ('${conversationId}', '${userId}', '${physicianId}', '${role}', '${content.replace(/'/g, "''")}')
    `);
  }
}

// Lazy singleton — only instantiated on first use
let clientInstance: SnowflakeClient | null = null;

export function getSnowflakeClient(): SnowflakeClient {
  if (!clientInstance) {
    clientInstance = new SnowflakeClient();
  }
  return clientInstance;
}