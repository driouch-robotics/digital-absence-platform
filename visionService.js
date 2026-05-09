const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const parseTimetableImage = async (imagePath) => {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const image = {
        inlineData: {
            data: Buffer.from(fs.readFileSync(imagePath)).toString("base64"),
            mimeType: "image/jpeg",
        },
    };

    const prompt = `
        Extract the school timetable from this image and return it as a JSON array of objects.
        Each object MUST have these keys: "class_name", "day_of_week" (in Arabic, e.g., الاثنين, الثلاثاء...), "period" (صباحية or مسائية), "session" (e.g., الحصة 1, الحصة 2...), and "subject".
        Return ONLY the raw JSON array. Do not include any markdown formatting, backticks, or "json" labels.
    `;

    const result = await model.generateContent([prompt, image]);
    const response = await result.response;
    return JSON.parse(response.text().trim());
};

const parseHolidayImage = async (imagePath) => {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const image = {
        inlineData: {
            data: Buffer.from(fs.readFileSync(imagePath)).toString("base64"),
            mimeType: "image/jpeg",
        },
    };

    const prompt = `
        Extract the official holiday dates from this image and return them as a JSON array of objects.
        Each object MUST have these keys: "holiday_date" (formatted as YYYY-MM-DD) and "description".
        Return ONLY the raw JSON array. Do not include any markdown formatting, backticks, or "json" labels.
    `;

    const result = await model.generateContent([prompt, image]);
    const response = await result.response;
    return JSON.parse(response.text().trim());
};

module.exports = { parseTimetableImage, parseHolidayImage };
