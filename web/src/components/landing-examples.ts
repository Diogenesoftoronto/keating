export type LandingExampleId = "recursion" | "photosynthesis" | "probability";

export interface LandingExample {
	id: LandingExampleId;
	label: string;
	provider: "ChatGPT" | "Claude" | "Gemini";
	query: string;
	/** Authored illustrations, not captured or attributed provider responses. */
	paragraphs: string[];
	practice: {
		context: string;
		stimulus: string;
		stimulusKind: "code" | "text";
		hint: string;
		question: string;
		choices: string[];
		items: string[];
		correctMatches: string[];
		choiceLabel: string;
		success: string;
		retry: string;
		feedback: string;
	};
}

export const LANDING_EXAMPLES: LandingExample[] = [
	{
		id: "recursion", label: "Recursion", provider: "ChatGPT", query: "Explain recursion.",
		paragraphs: [
			"Recursion is a programming technique in which a function calls itself to solve a smaller instance of the same problem. A recursive function generally has two parts: a base case, which returns a result without making another call, and a recursive case, which reduces the problem and calls the function again.",
			"For example, to sum the integers from zero to a positive integer n, a recursive function can return zero when n is zero, and otherwise return n plus the result of calling the function with n minus one. The call sum(2) therefore becomes 2 + sum(1), which becomes 2 + 1 + sum(0). Once the base case returns zero, the waiting calls finish, giving a final result of three.",
			"Each unfinished call has a frame on the call stack. Those frames hold the information needed to continue after the smaller call returns. Calls must make progress toward a base case; otherwise, recursion can exhaust the stack. Understanding both the descent into smaller calls and the return through waiting calls is essential to reasoning about recursive programs.",
		],
		practice: {
			context: "Understand recursion · you know functions",
			stimulus: "function sum(n) {\n  return n === 0 ? 0 : n + sum(n - 1);\n}", stimulusKind: "code",
			hint: "sum(0) reaches the base case and returns 0. It makes no further call. Use that return value to work back outward.",
			question: "What comes back first?", choices: ["0", "1", "3"], items: ["sum(0) returns", "sum(1) returns", "sum(2) returns"], correctMatches: ["0", "1", "3"], choiceLabel: "Match each call to its return value",
			success: "You rebuilt the return path.", retry: "Start at the base case.",
			feedback: "sum(0) returns 0 first. Then sum(1) returns 1 + 0 = 1, and sum(2) returns 2 + 1 = 3. Each waiting call finishes as the stack unwinds.",
		},
	},
	{
		id: "photosynthesis", label: "Photosynthesis", provider: "Claude", query: "Explain photosynthesis.",
		paragraphs: [
			"Photosynthesis is the process by which plants, algae, and some bacteria use light energy to build organic compounds. In plants, it takes place in chloroplasts. The overall process uses carbon dioxide and water to build sugars, while releasing oxygen. Light provides the energy needed to drive the chemical transformations; it does not supply the atoms from which sugar is assembled.",
			"The light-dependent reactions take place in the thylakoid membranes. Chlorophyll absorbs light, which helps drive electron transfer and the production of ATP and NADPH. Water is split to replenish electrons, releasing oxygen in the process. The oxygen gas released by a plant therefore originates from water, rather than from the carbon dioxide taken in from the air.",
			"The Calvin cycle uses ATP and NADPH to incorporate carbon from carbon dioxide into organic molecules. These molecules can be used to build sugars and other plant materials. Following the carbon atoms, oxygen atoms, and energy separately helps distinguish the roles of the inputs. A summary equation describes the overall balance, but does not by itself reveal every reaction or the path each atom follows.",
		],
		practice: {
			context: "Understand photosynthesis · you know atoms are conserved",
			stimulus: "A leaf takes in CO₂, water, and sunlight. It builds sugar and releases oxygen. Trace the atoms separately from the energy.", stimulusKind: "text",
			hint: "Track carbon first: CO₂ brings carbon atoms into the leaf. Sunlight carries energy, not carbon atoms.",
			question: "Where does each contribution go?", choices: ["Sugar’s carbon", "Released oxygen", "Energy, not atoms"], items: ["Carbon from CO₂", "Oxygen from water", "Incoming sunlight"], correctMatches: ["Sugar’s carbon", "Released oxygen", "Energy, not atoms"], choiceLabel: "Rebuild the path from inputs to products",
			success: "You separated matter from energy.", retry: "Trace the atoms separately from the energy.",
			feedback: "CO₂ supplies the carbon used to build sugar. Splitting water releases oxygen gas. Light supplies energy to drive the process—it does not become the sugar’s atoms.",
		},
	},
	{
		id: "probability", label: "Probability", provider: "Gemini", query: "Explain probability with a die.",
		paragraphs: [
			"Probability measures how likely an event is to occur. For a finite set of equally likely outcomes, the probability of an event is the number of outcomes that satisfy the event divided by the total number of possible outcomes. A fair six-sided die has six equally likely outcomes, numbered one through six. An event can include one outcome or several outcomes.",
			"For example, the probability of rolling exactly six is one out of six, because only one face satisfies the event. The probability of rolling an even number is three out of six, or one half, because two, four, and six are even. The probability of rolling a number less than five is four out of six, or two thirds, because one, two, three, and four satisfy the condition.",
			"The equally likely assumption matters: simply counting outcomes would not give the correct probabilities for a biased die. Event wording also matters, because less than five excludes five, whereas at most five includes it. Listing the outcomes before simplifying the fraction is a useful way to check both the interpretation of an event and the resulting calculation.",
		],
		practice: {
			context: "Understand probability · you know fractions",
			stimulus: "One roll of a fair six-sided die.\nPossible outcomes: 1, 2, 3, 4, 5, 6.\nEach outcome is equally likely.", stimulusKind: "text",
			hint: "List the outcomes for one event before counting them. “Exactly 6” has just one matching outcome among the six possible faces.",
			question: "Which outcomes make each event true?", choices: ["1/6", "1/2", "2/3"], items: ["Exactly 6", "An even number", "A number less than 5"], correctMatches: ["1/6", "1/2", "2/3"], choiceLabel: "Count matching outcomes, then choose the probability",
			success: "You built the probabilities from outcomes.", retry: "List the matching faces before choosing a fraction.",
			feedback: "Exactly 6 gives {6}: 1/6. Even gives {2, 4, 6}: 3/6 = 1/2. Less than 5 gives {1, 2, 3, 4}: 4/6 = 2/3. The fractions follow from the outcomes you counted.",
		},
	},
];
