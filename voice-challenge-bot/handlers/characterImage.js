const SYSTEM_PROMPT = `あなたはアニメキャラクターデザインの専門家です。
以下のルールに従い、ボイスサンプルの台本テキストからキャラクターの外見を英語の画像生成プロンプトとして出力してください。

【解析ルール】
1. セリフの口調・語彙・感情から以下を推測する：
   - 性別、年齢帯、性格傾向、社会的立場

2. 推測した性格・立場から外見要素を決定する：
   - 髪型・髪色、目の形・色、表情、体格、服装、背景

3. 出力は英語のみ。1つの段落で、画像生成AIに直接渡せるプロンプトとして出力すること。
   例: "A young male anime character with short messy black hair, sharp brown eyes, determined expression, wearing a school uniform..."

4. 画風は現代アニメ調。曖昧な場合はアニメの王道設定に寄せる。

5. 【重要】「ト書き」や演技指示（例：「怒りを込めて」「優しく」等の演技ディレクション）は
   ユーザーへの演技指導であり、キャラクターの外見とは無関係です。
   これらは完全に無視し、外見描写に一切反映しないでください。

6. 台本のセリフ内容とシチュエーションのみからキャラクターの外見を推測すること。

7. 絶対に出力しないもの：実在の人物に似せた描写、過度な露出、暴力的・性的・グロテスクな表現。`;

/**
 * 台本テキストからキャラクター画像を生成する
 * @param {string} scriptText - 台本テキスト
 * @param {string} gender - "male" or "female"
 * @returns {Buffer|null} 画像のBufferデータ（失敗時はnull）
 */
async function generateCharacterImage(scriptText, gender) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY が設定されていません');
        return null;
    }

    try {
        // ト書き行を除去してセリフのみにする
        const cleanedScript = scriptText
            .split('\n')
            .filter(line => !line.trim().startsWith('【ト書き】'))
            .join('\n');

        // Step 1: 台本からキャラ解析→英語プロンプト生成
        console.log(`[キャラ画像] ${gender} のキャラクター解析中...`);
        const analysisEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const genderHint = gender === 'male' ? 'This character is male.' : 'This character is female.';

        const analysisRes = await fetch(analysisEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [{ text: `${genderHint}\n\nAnalyze this script and generate an image prompt:\n\n${cleanedScript}` }]
                }],
                systemInstruction: {
                    parts: [{ text: SYSTEM_PROMPT }]
                },
                generationConfig: { temperature: 0.7 }
            })
        });

        const analysisData = await analysisRes.json();
        if (!analysisRes.ok) {
            console.error('[キャラ画像] 解析APIエラー:', analysisData.error?.message);
            return null;
        }

        const englishPrompt = analysisData.candidates[0].content.parts[0].text;
        console.log(`[キャラ画像] プロンプト生成完了: ${englishPrompt.substring(0, 100)}...`);

        // Step 2: 画像生成
        console.log(`[キャラ画像] ${gender} の画像生成中...`);
        const imageEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`;

        const imageRes = await fetch(imageEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [{ text: `High-quality anime character illustration. ${englishPrompt}. Modern anime style, square composition. Single character, professional character design quality.` }]
                }],
                generationConfig: {
                    responseModalities: ["TEXT", "IMAGE"]
                }
            })
        });

        const imageData = await imageRes.json();
        if (!imageRes.ok) {
            console.error('[キャラ画像] 画像生成APIエラー:', imageData.error?.message);
            return null;
        }

        const parts = imageData.candidates[0].content.parts;
        const imagePart = parts.find(p => p.inlineData);

        if (!imagePart) {
            console.error('[キャラ画像] 画像データが返されませんでした');
            return null;
        }

        console.log(`[キャラ画像] ${gender} の画像生成完了!`);
        return Buffer.from(imagePart.inlineData.data, 'base64');

    } catch (error) {
        console.error(`[キャラ画像] ${gender} の処理中にエラー:`, error);
        return null;
    }
}

module.exports = { generateCharacterImage };