import tsParser from "@typescript-eslint/parser";
import jsdoc from "eslint-plugin-jsdoc";
import tsdoc from "eslint-plugin-tsdoc";

export default [
	{
		files: ["src/shared/lib/**/*.ts"],
		ignores: ["src/shared/lib/**/*.test.ts"],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: "latest",
			sourceType: "module",
		},
		plugins: {
			jsdoc,
			tsdoc,
		},
		rules: {
			"tsdoc/syntax": "error",
			"jsdoc/require-jsdoc": [
				"error",
				{
					publicOnly: true,
					require: {
						FunctionDeclaration: true,
						ClassDeclaration: true,
						MethodDefinition: false,
						ArrowFunctionExpression: false,
						FunctionExpression: false,
					},
				},
			],
		},
	},
];
