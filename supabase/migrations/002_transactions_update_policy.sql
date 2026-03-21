-- Allow users to update their own transactions
CREATE POLICY transactions_update ON transactions FOR UPDATE
  USING (position_id IN (
    SELECT p.id FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE pf.user_id = auth.uid()
  ));