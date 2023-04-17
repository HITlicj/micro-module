module.exports = {
  extends: [require.resolve('@atom-web/fabric/lib/eslint')],
  rules: {
    'react/require-default-props': 0,
    'no-console': 'warn',
    'prefer-rest-params': 0,
    'no-new-func': 0,
    'react/jsx-props-no-spreading': 0,
    'react/static-property-placement': 0,
  },
};
